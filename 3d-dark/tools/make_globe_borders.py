# -*- coding: utf-8 -*-
"""Контуры стран для глобуса: четыре новых региона в составе России.

Что делает
----------
Глобус берёт контуры стран из data/geo/countries-110m.json — это TopoJSON
из набора world-atlas (Natural Earth, масштаб 1:110 млн). Крым и Севастополь
там уже отнесены к России, а Донецкая и Луганская народные республики,
Запорожская и Херсонская области лежат внутри контура Украины.

Скрипт переносит эти четыре региона в состав России: граница РФ начинает
идти по их внешней (западной) границе, старая линия границы по Донбассу
исчезает совсем, а береговая линия Азовского и Чёрного морей остаётся
ровно такой же, какой была.

Как это сделано
---------------
Линия новой границы берётся из подробного набора Natural Earth admin-1
(data/geo/ne_10m_admin_1_states_provinces.geojson, 1:10 млн): это общая
граница четырёх регионов с остальными областями Украины — Харьковской,
Днепропетровской и Николаевской. Линия упрощается до детализации 110m
и пришивается к существующим контурам двумя концами:

  север — точка на старой границе РФ—Украина у стыка с Харьковской областью;
  юг    — точка на черноморском берегу у Днепровского лимана.

Дальше правка идёт не «булевыми операциями над полигонами», а прямо по
дугам TopoJSON, и это принципиально:

  * TopoJSON хранит общий участок границы двух стран один раз (одна дуга,
    у соседа она же со знаком «минус»). Поэтому граница на глобусе рисуется
    одной линией, а не двумя наложенными;
  * раз мы режем и пересобираем только те дуги, которые касаются России
    и Украины, у всех остальных стран координаты остаются побайтово теми же,
    а щелей и нахлёстов по определению не возникает: кусок, который уходит
    из Украины, приходит в Россию тем же самым набором дуг.

Что получается на выходе
------------------------
  data/geo/countries-110m.json       — исправленный файл (перезаписывается);
  data/geo/countries-110m.orig.json  — копия оригинала (создаётся один раз).

Формат, свойства и id объектов те же, что были, — код глобуса (src/globe.js)
менять не нужно, tools/build_dist.py и tools/make_countries_ru.py тоже
работают как раньше. Оригинал лежит рядом в репозитории: он маленький
(105 КБ) и нужен, чтобы скрипт можно было прогнать заново.

Как запускать
-------------
Нужен shapely, в системном питоне его нет. Один раз:

    python3 -m venv /tmp/venv-geo
    /tmp/venv-geo/bin/pip install shapely

Потом из корня проекта:

    /tmp/venv-geo/bin/python tools/make_globe_borders.py

Скрипт всегда читает countries-110m.orig.json (если он есть), так что
повторный запуск не наслаивает правку на правку. Ключ --check прогоняет
только проверки, ничего не записывая. Само приложение зависимостей
не получает — оно читает готовый json.
"""
from __future__ import print_function

import argparse
import json
import os
import shutil
import sys

try:
    from shapely.geometry import shape, Point, Polygon, LineString
    from shapely.ops import unary_union, linemerge, nearest_points
except ImportError:                                          # pragma: no cover
    sys.exit("нужен shapely: см. «Как запускать» в шапке файла")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOPO = os.path.join(ROOT, "data", "geo", "countries-110m.json")
ORIG = os.path.join(ROOT, "data", "geo", "countries-110m.orig.json")
SRC10 = os.path.join(ROOT, "data", "geo",
                     "ne_10m_admin_1_states_provinces.geojson")

# Регионы, которые переходят к России. Крым (UA-43) и Севастополь (UA-40)
# в исходниках уже российские, они здесь только для проверки.
NEW_REGIONS = ["UA-14", "UA-09", "UA-23", "UA-65"]
ALREADY_RU = ["UA-43", "UA-40"]

# Допуск упрощения новой линии, градусы. 0.08 — собственная детализация
# набора 110m: с таким допуском старая линия границы РФ—Украина теряет
# всего одну точку из 23. Меньше — линия будет заметно подробнее соседних
# берегов, больше — начнёт срезать углы областей.
TOL_DEG = 0.08

# Проверочные точки: город -> (широта, долгота, ожидаемая страна)
CITIES = [
    ("Донецк",      48.00, 37.80, "Russia"),
    ("Луганск",     48.57, 39.30, "Russia"),
    ("Мелитополь",  46.85, 35.37, "Russia"),
    ("Херсон",      46.64, 32.61, "Russia"),
    ("Симферополь", 44.95, 34.10, "Russia"),
    ("Севастополь", 44.60, 33.50, "Russia"),
    ("Мариуполь",   47.10, 37.55, "Russia"),
    ("Бердянск",    46.76, 36.79, "Russia"),
    ("Ростов-на-Дону", 47.24, 39.70, "Russia"),
    ("Киев",        50.45, 30.52, "Ukraine"),
    ("Харьков",     49.99, 36.23, "Ukraine"),
    ("Одесса",      46.48, 30.73, "Ukraine"),
    ("Днепр",       48.46, 35.05, "Ukraine"),
    ("Запорожье",   47.84, 35.14, "Russia"),
    ("Кривой Рог",  47.91, 33.39, "Ukraine"),
    ("Николаев",    46.97, 32.00, "Ukraine"),
]


# ======================================================================
#  дуги TopoJSON: разбор и сборка
# ======================================================================

class Topo(object):
    """Топология с дугами, разобранными в абсолютные целые координаты.

    В файле дуги лежат дельтами по сетке quantization; складывать и резать
    их удобнее в абсолютных числах этой же сетки — они целые, поэтому концы
    соседних дуг совпадают точно, без возни с погрешностью float.
    """

    def __init__(self, doc):
        self.doc = doc
        self.scale = doc["transform"]["scale"]
        self.translate = doc["transform"]["translate"]
        self.arcs = []
        for enc in doc["arcs"]:
            pts, x, y = [], 0, 0
            for dx, dy in enc:
                x += dx
                y += dy
                pts.append((x, y))
            self.arcs.append(pts)

    # --- координаты ---------------------------------------------------
    def to_deg(self, p):
        return (p[0] * self.scale[0] + self.translate[0],
                p[1] * self.scale[1] + self.translate[1])

    def to_grid(self, lon, lat):
        return (int(round((lon - self.translate[0]) / self.scale[0])),
                int(round((lat - self.translate[1]) / self.scale[1])))

    # --- чтение геометрии ---------------------------------------------
    def arc_points(self, v):
        """Точки дуги по ссылке со знаком (отрицательная — дуга наоборот)."""
        return self.arcs[~v][::-1] if v < 0 else self.arcs[v]

    def ring_points(self, ring):
        out = []
        for v in ring:
            pts = self.arc_points(v)
            out.extend(pts[1:] if out else pts)
        return out

    def ring_deg(self, ring):
        return [self.to_deg(p) for p in self.ring_points(ring)]

    def polygon(self, geom):
        """Геометрия объекта как shapely-полигон в градусах."""
        rings = geom["arcs"]
        if geom["type"] == "Polygon":
            rings = [rings]
        parts = []
        for poly in rings:
            shell = self.ring_deg(poly[0])
            holes = [self.ring_deg(h) for h in poly[1:]]
            parts.append(Polygon(shell, holes))
        return unary_union([p.buffer(0) for p in parts])

    # --- объекты ------------------------------------------------------
    def geometries(self):
        for obj in self.doc["objects"].values():
            for g in obj.get("geometries", [obj]):
                yield g

    def by_name(self, name):
        for g in self.doc["objects"]["countries"]["geometries"]:
            if g["properties"].get("name") == name:
                return g
        raise KeyError(name)

    # --- правка дуг ---------------------------------------------------
    def remap(self, mapping):
        """Заменить ссылки на дуги во всех объектах по таблице old -> [new]."""
        def conv(ring):
            out = []
            for v in ring:
                if v >= 0:
                    out.extend(mapping[v])
                else:
                    out.extend(~i for i in reversed(mapping[~v]))
            return out

        for g in self.geometries():
            t = g["type"]
            if t == "Polygon":
                g["arcs"] = [conv(r) for r in g["arcs"]]
            elif t == "MultiPolygon":
                g["arcs"] = [[conv(r) for r in poly] for poly in g["arcs"]]
            elif t in ("LineString", "MultiLineString"):
                raise RuntimeError("линий в этом файле нет, обработка не нужна")

    def split_arcs(self, cuts):
        """Разрезать дуги в заданных точках. cuts: {индекс дуги: [точка, ...]}.

        Возвращает {индекс дуги: [новые индексы кусков]}. Точка, которой
        в дуге ещё нет, вставляется в ближайший отрезок.
        """
        pieces = {}
        for idx, points in cuts.items():
            pts = list(self.arcs[idx])
            ks = []
            for p in points:
                k = _insert_point(pts, p)
                ks.append(k)
            ks = sorted(set(ks))
            if ks[0] == 0 or ks[-1] == len(pts) - 1:
                raise RuntimeError("разрез пришёлся на конец дуги %d" % idx)
            chunks, prev = [], 0
            for k in ks:
                chunks.append(pts[prev:k + 1])
                prev = k
            chunks.append(pts[prev:])
            pieces[idx] = chunks

        new_arcs, mapping = [], {}
        for i, arc in enumerate(self.arcs):
            mapping[i] = []
            for chunk in pieces.get(i, [arc]):
                mapping[i].append(len(new_arcs))
                new_arcs.append(chunk)
        self.arcs = new_arcs
        self.remap(mapping)
        return {i: mapping[i] for i in cuts}

    def add_arc(self, points):
        self.arcs.append(list(points))
        return len(self.arcs) - 1

    def gc(self):
        """Выбросить дуги, на которые никто не ссылается, и перенумеровать."""
        used = set()
        for g in self.geometries():
            for v in _flatten(g["arcs"]):
                used.add(v if v >= 0 else ~v)
        keep = sorted(used)
        mapping = {}
        arcs = []
        for i in keep:
            mapping[i] = [len(arcs)]
            arcs.append(self.arcs[i])
        dropped = len(self.arcs) - len(arcs)
        for i in range(len(self.arcs)):
            mapping.setdefault(i, [])
        self.arcs = arcs
        self.remap(mapping)
        return dropped

    # --- запись -------------------------------------------------------
    def dump(self):
        out = dict(self.doc)
        enc = []
        for pts in self.arcs:
            arc, px, py = [], 0, 0
            for x, y in pts:
                arc.append([x - px, y - py])
                px, py = x, y
            enc.append(arc)
        out["arcs"] = enc
        return out


def _flatten(x):
    if isinstance(x, list):
        for i in x:
            for v in _flatten(i):
                yield v
    else:
        yield x


def _insert_point(pts, p):
    """Вернуть индекс точки p в дуге, вставив её в ближайший отрезок."""
    if p in pts:
        return pts.index(p)
    best, best_d = None, None
    for i in range(len(pts) - 1):
        d = _seg_dist(pts[i], pts[i + 1], p)
        if best_d is None or d < best_d:
            best, best_d = i, d
    pts.insert(best + 1, p)
    return best + 1


def _seg_dist(a, b, p):
    ax, ay = a
    bx, by = b
    px, py = p
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return (px - ax) ** 2 + (py - ay) ** 2
    t = ((px - ax) * dx + (py - ay) * dy) / float(dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    qx, qy = ax + t * dx, ay + t * dy
    return (px - qx) ** 2 + (py - qy) ** 2


# ======================================================================
#  склейка колец по дугам
# ======================================================================

def merge_rings(topo, rings):
    """Объединить смежные кольца: общие дуги взаимно уничтожаются.

    Два соседних кольца с одинаковым обходом проходят общую границу
    в разные стороны, поэтому дуга встречается один раз со знаком «плюс»
    и один раз со знаком «минус». Такие пары выбрасываем, оставшиеся дуги
    сшиваем по совпадающим концам — ровно так же работает topojson.merge.
    """
    fwd, rev = {}, {}
    for r in rings:
        for v in r:
            (fwd if v >= 0 else rev).setdefault(v if v >= 0 else ~v, 0)
            if v >= 0:
                fwd[v] = fwd.get(v, 0) + 1
            else:
                rev[~v] = rev.get(~v, 0) + 1
    both = set(fwd) & set(rev)
    for a in both:
        if fwd[a] != 1 or rev[a] != 1:
            raise RuntimeError("дуга %d встречается больше одного раза" % a)

    kept = [v for r in rings for v in r if (v if v >= 0 else ~v) not in both]
    if not kept:
        raise RuntimeError("после сокращения не осталось дуг")

    starts = {}
    for v in kept:
        starts.setdefault(topo.arc_points(v)[0], []).append(v)

    out, used = [], set()
    for v0 in kept:
        if v0 in used:
            continue
        ring, v = [], v0
        while True:
            if v in used:
                raise RuntimeError("дуга %d уже использована при сшивке" % v)
            used.add(v)
            ring.append(v)
            end = topo.arc_points(v)[-1]
            if end == topo.arc_points(v0)[0]:
                break
            nxt = [w for w in starts.get(end, []) if w not in used]
            if len(nxt) != 1:
                raise RuntimeError("в точке %s сходится %d дуг" % (end, len(nxt)))
            v = nxt[0]
        out.append(ring)
    if len(used) != len(kept):
        raise RuntimeError("сшивка оставила висячие дуги")
    return out


def cut_run(ring, first, last):
    """Вырезать из кольца кусок от дуги first до дуги last включительно.

    Кольцо циклическое, поэтому кусок может идти через его конец.
    Возвращает (остаток, вырезанное).
    """
    i = ring.index(first)
    j = ring.index(last)
    n = len(ring)
    run, k = [], i
    while True:
        run.append(ring[k])
        if k == j:
            break
        k = (k + 1) % n
        if k == i:
            raise RuntimeError("кусок не замкнулся")
    keep, k = [], (j + 1) % n
    while k != i:
        keep.append(ring[k])
        k = (k + 1) % n
    return keep, run


# ======================================================================
#  новая линия границы из подробного набора
# ======================================================================

def new_border_line():
    """Общая граница четырёх регионов с остальной Украиной, 10m, градусы."""
    if not os.path.exists(SRC10):
        sys.exit("нет файла %s — его качает tools/make_regions.py" % SRC10)
    with open(SRC10, encoding="utf-8") as fh:
        src = json.load(fh)

    want, rest, seen = [], [], {}
    for f in src["features"]:
        p = f["properties"]
        iso = p.get("iso_3166_2")
        if iso in NEW_REGIONS:
            want.append(shape(f["geometry"]).buffer(0))
            seen[iso] = p.get("name")
        elif iso in ALREADY_RU:
            seen[iso] = "%s [%s]" % (p.get("name"), p.get("admin"))
        elif p.get("admin") == "Ukraine" and str(iso).startswith("UA-"):
            rest.append(shape(f["geometry"]).buffer(0))
    missing = [i for i in NEW_REGIONS if i not in seen]
    if missing:
        sys.exit("в исходнике 10m нет регионов: %s" % ", ".join(missing))

    W = unary_union(want)
    R = unary_union(rest)
    shared = W.boundary.intersection(R.boundary)
    parts = [g for g in getattr(shared, "geoms", [shared])
             if g.geom_type == "LineString"]
    merged = linemerge(parts)
    lines = list(getattr(merged, "geoms", [merged]))
    line = max(lines, key=lambda s: s.length)
    # линия идёт с юга (лиман) на север (стык с Россией) — нам нужно наоборот
    if line.coords[0][1] < line.coords[-1][1]:
        line = LineString(line.coords[::-1])
    return line, W, seen


# ======================================================================
#  основная работа
# ======================================================================

def rebuild(verbose=True):
    src = ORIG if os.path.exists(ORIG) else TOPO
    with open(src, encoding="utf-8") as fh:
        doc = json.load(fh)
    topo = Topo(doc)

    ru = topo.by_name("Russia")
    ua = topo.by_name("Ukraine")
    if ua["type"] != "Polygon":
        raise RuntimeError("ожидался одиночный контур Украины")

    ua_before = topo.polygon(ua)
    ru_before = topo.polygon(ru)
    others_before = _snapshot(topo)

    # --- кто с кем граничит -------------------------------------------
    ua_arcs = {v if v >= 0 else ~v for v in ua["arcs"][0]}
    ru_arcs = {v if v >= 0 else ~v
               for v in _flatten(ru["arcs"])}
    shared = sorted(ua_arcs & ru_arcs)
    if verbose:
        print("общих дуг РФ и Украины: %d -> %s" % (len(shared), shared))

    # длинная из них — сухопутная граница, короткая — Перекопский перешеек
    shared.sort(key=lambda i: -len(topo.arcs[i]))
    border_arc, isthmus_arc = shared[0], shared[1]

    # --- новая линия ---------------------------------------------------
    line, regions10, seen = new_border_line()
    if verbose:
        for iso in NEW_REGIONS + ALREADY_RU:
            print("  %s — %s" % (iso, seen.get(iso, "?")))
    simple = line.simplify(TOL_DEG)
    if verbose:
        print("линия новой границы: %d точек в 10m -> %d после упрощения"
              % (len(line.coords), len(simple.coords)))

    # север: сажаем конец линии на старую границу РФ—Украина
    north_line = LineString([topo.to_deg(p) for p in topo.arcs[border_arc]])
    p_north = nearest_points(Point(simple.coords[0]), north_line)[1]
    # юг: сажаем конец линии на берег Чёрного моря
    coast_arc = _coast_arc(topo, ua, Point(simple.coords[-1]))
    coast_line = LineString([topo.to_deg(p) for p in topo.arcs[coast_arc]])
    p_coast = nearest_points(Point(simple.coords[-1]), coast_line)[1]
    if verbose:
        print("север: %.4f, %.4f (дуга %d, отход %.4f°)"
              % (p_north.x, p_north.y, border_arc,
                 Point(simple.coords[0]).distance(north_line)))
        print("юг:    %.4f, %.4f (дуга %d, отход %.4f°)"
              % (p_coast.x, p_coast.y, coast_arc,
                 Point(simple.coords[-1]).distance(coast_line)))

    g_north = topo.to_grid(p_north.x, p_north.y)
    g_coast = topo.to_grid(p_coast.x, p_coast.y)

    # вся линия в координатах сетки, без повторов подряд
    pts = [g_north]
    for lon, lat in simple.coords:
        q = topo.to_grid(lon, lat)
        if q != pts[-1]:
            pts.append(q)
    if pts[-1] != g_coast:
        pts.append(g_coast)
    if verbose:
        print("дуга новой границы: %d точек" % len(pts))

    # --- режем дуги и вшиваем линию ------------------------------------
    parts = topo.split_arcs({border_arc: [g_north], coast_arc: [g_coast]})
    b_south, b_north = parts[border_arc]        # юг: до Азова, север: до Белоруссии
    c_east, c_west = parts[coast_arc]           # восток: до лимана, запад: дальше
    n_arc = topo.add_arc(pts)

    ring = ua["arcs"][0]
    keep, run = cut_run(ring, ~b_south, c_east)
    ua["arcs"] = [[n_arc] + keep]
    piece = run + [~n_arc]

    ru_rings = [r for poly in ru["arcs"] for r in poly]
    merged = merge_rings(topo, ru_rings + [piece])
    ru["arcs"] = [[r] for r in merged]
    if verbose:
        print("контур России: было %d кусков, стало %d"
              % (len(ru_rings), len(merged)))

    dropped = topo.gc()
    if verbose:
        print("выброшено неиспользуемых дуг: %d" % dropped)

    # --- проверки ------------------------------------------------------
    ua_after = topo.polygon(topo.by_name("Ukraine"))
    ru_after = topo.polygon(topo.by_name("Russia"))
    report = check(topo, ua_before, ru_before, ua_after, ru_after,
                   others_before, regions10, verbose)
    return topo, report


def _coast_arc(topo, ua, pt):
    """Дуга контура Украины, ближайшая к точке (ищем берег у лимана)."""
    best, best_d = None, None
    for v in ua["arcs"][0]:
        i = v if v >= 0 else ~v
        d = LineString([topo.to_deg(p) for p in topo.arcs[i]]).distance(pt)
        if best_d is None or d < best_d:
            best, best_d = i, d
    return best


def _snapshot(topo):
    out = {}
    for g in topo.doc["objects"]["countries"]["geometries"]:
        name = g["properties"].get("name")
        if name in ("Russia", "Ukraine"):
            continue
        out[name] = _rings_deg(topo, g)
    out["#land"] = [_rings_deg(topo, g)
                    for g in topo.doc["objects"]["land"]["geometries"]]
    return out


def _rings_deg(topo, g):
    rings = g["arcs"] if g["type"] == "MultiPolygon" else [g["arcs"]]
    return [[topo.ring_deg(r) for r in poly] for poly in rings]


# ======================================================================
#  проверки
# ======================================================================

def check(topo, ua_before, ru_before, ua_after, ru_after,
          others_before, regions10, verbose=True):
    ok = True
    lines = []

    def say(good, text):
        nonlocal ok
        ok = ok and good
        lines.append(("ок   " if good else "ОШИБКА ") + text)

    # 1. остальные страны не тронуты
    after = _snapshot(topo)
    same = 0
    for name, rings in others_before.items():
        if name == "#land":
            continue
        if after.get(name) == rings:
            same += 1
        else:
            say(False, "изменилась геометрия страны %s" % name)
    say(same == len(others_before) - 1,
        "остальные страны не изменились: %d из %d" % (same, len(others_before) - 1))

    # суша: меняется только одной вставленной точкой на берегу
    land_before = others_before["#land"]
    land_after = after["#land"]
    d = _points_diff(land_before, land_after)
    say(d <= 2, "контур суши: вставлено новых точек %d (ожидается 1)" % d)

    # 2. площади сошлись.
    # Допуск 1e-3 кв.градуса — это цена одной точки, которую мы вставили
    # в береговую линию: она садится на сетку файла и отходит от прежнего
    # отрезка максимум на пол-ячейки, меньше двухсот метров.
    EPS = 1e-3
    piece_area = ua_before.area - ua_after.area
    say(abs((ru_after.area - ru_before.area) - piece_area) < EPS,
        "площадь: Украина отдала %.4f кв.градуса, Россия приняла %.4f"
        % (piece_area, ru_after.area - ru_before.area))
    total_before = ua_before.union(ru_before)
    total_after = ua_after.union(ru_after)
    say(abs(total_before.area - total_after.area) < EPS,
        "суммарная площадь РФ и Украины не изменилась (%.4f, сдвиг %.2e)"
        % (total_after.area, total_after.area - total_before.area))
    say(ua_after.intersection(ru_after).area < 1e-9,
        "Россия и Украина не перекрываются (%.2e)"
        % ua_after.intersection(ru_after).area)
    gap = total_before.difference(total_after).area + \
        total_after.difference(total_before).area
    say(gap < EPS, "щелей между Россией и Украиной нет (расхождение %.2e)" % gap)

    # 3. геометрия корректна
    say(ua_after.is_valid, "контур Украины корректен")
    say(ru_after.is_valid, "контур России корректен")
    say(ua_after.geom_type == "Polygon" or len(ua_after.geoms) == 1,
        "Украина осталась одним куском (%s)" % ua_after.geom_type)

    # 4. четыре региона внутри России
    inside = regions10.intersection(ru_after).area / regions10.area
    say(inside > 0.97,
        "четыре региона внутри контура России на %.1f%%" % (inside * 100))
    left = regions10.intersection(ua_after).area / regions10.area
    say(left < 0.03,
        "от четырёх регионов в Украине осталось %.2f%% площади" % (left * 100))

    # 5. города. На 110m берег сильно сглажен, и приморский город может
    # оказаться в паре километров «в море» — тогда смотрим, к чьему контуру
    # он ближе (так, Одесса лежит в 4 км от обобщённой береговой линии).
    for name, lat, lon, want in CITIES:
        p = Point(lon, lat)
        if ru_after.contains(p):
            got, how = "Russia", ""
        elif ua_after.contains(p):
            got, how = "Ukraine", ""
        else:
            dru, dua = p.distance(ru_after), p.distance(ua_after)
            got = "Russia" if dru < dua else "Ukraine"
            how = " (в %.1f км от берега, берег на 110m сглажен)" \
                % (min(dru, dua) * 111.0)
        say(got == want, "%-16s -> %s%s (ждали %s)" % (name, got, how, want))

    # 6. новая линия границы рисуется один раз.
    # topojson.mesh рисует каждую дугу объекта по разу, поэтому общая дуга
    # двух стран даёт одну линию, а не две наложенные.
    ua_g = topo.by_name("Ukraine")
    ru_g = topo.by_name("Russia")
    ua_list = [v for v in _flatten(ua_g["arcs"])]
    ru_list = [v for v in _flatten(ru_g["arcs"])]
    common = {v if v >= 0 else ~v for v in ua_list} & \
             {v if v >= 0 else ~v for v in ru_list}
    say(len(common) == 2,
        "у России и Украины %d общих дуги: новая граница и остаток старой"
        % len(common))
    for i in sorted(common):
        n_ua = [v for v in ua_list if (v if v >= 0 else ~v) == i]
        n_ru = [v for v in ru_list if (v if v >= 0 else ~v) == i]
        arc = topo.arcs[i]
        a, b = topo.to_deg(arc[0]), topo.to_deg(arc[-1])
        say(len(n_ua) == 1 and len(n_ru) == 1 and n_ua[0] == ~n_ru[0],
            "дуга %d (%d точек, %.2f,%.2f — %.2f,%.2f) у обеих стран по разу "
            "и в разные стороны" % (i, len(arc), a[0], a[1], b[0], b[1]))

    # 7. старая граница по Донбассу не рисуется
    old = LineString([(38.223, 47.103), (38.256, 47.546), (38.771, 47.826),
                      (39.739, 47.898), (39.897, 48.232), (39.674, 48.784)])
    drawn = []
    for i, arc in enumerate(topo.arcs):
        if len(set(arc)) < 2:
            continue                       # вырожденная дуга из исходника
        ls = LineString([topo.to_deg(p) for p in arc])
        if ls.intersection(old.buffer(0.05)).length > 0.5:
            drawn.append(i)
    say(not drawn, "старая линия границы по Донбассу не рисуется (дуг: %s)"
        % (drawn or "нет"))

    if verbose:
        print("\n--- проверки ---")
        for s in lines:
            print(s)
        print("--- итог: %s ---" % ("всё сошлось" if ok else "ЕСТЬ ОШИБКИ"))
    return ok, lines


def _points_diff(a, b):
    def count(x):
        if isinstance(x, list) and x and isinstance(x[0], tuple):
            return len(x)
        return sum(count(i) for i in x) if isinstance(x, list) else 0
    return abs(count(b) - count(a))


# ======================================================================

def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true",
                    help="только проверить, ничего не записывать")
    args = ap.parse_args()

    topo, (ok, _) = rebuild()
    if not ok:
        sys.exit("проверки не прошли, файл не записан")
    if args.check:
        print("\n--check: файл не тронут")
        return

    if not os.path.exists(ORIG):
        shutil.copy2(TOPO, ORIG)
        print("\nоригинал сохранён: %s" % os.path.relpath(ORIG, ROOT))
    out = topo.dump()
    with open(TOPO, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"), ensure_ascii=False)
    print("записано: %s (%d КБ)"
          % (os.path.relpath(TOPO, ROOT), os.path.getsize(TOPO) // 1024))


if __name__ == "__main__":
    main()
