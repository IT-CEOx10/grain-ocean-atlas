# -*- coding: utf-8 -*-
"""Контуры субъектов России для экрана «Госмониторинг пшеницы РФ».

Берёт открытый набор Natural Earth (admin-1, масштаб 1:10 млн, public domain),
оставляет Россию, приводит названия к русским, проецирует страну конической
проекцией Альберса и упрощает геометрию с сохранением топологии.
Результат — assets/geo/russia-regions.json, около 300 КБ.

    python3 tools/make_regions.py

Исходник скачивается сам (40 МБ) и кладётся в data/geo/; в репозиторий он
не идёт (см. .gitignore). Ключ --src укажет свой файл.

Почему координаты в файле уже спроецированы
-------------------------------------------
Россия переходит через 180-й меридиан: в градусах Чукотка лежит на другом
краю мира и на плоской карте улетает за океан. Поэтому долгота сдвигается
к центральному меридиану 100° в. д. и заворачивается в (-180, 180], а потом
точка считается по равновеликой конической проекции Альберса с параллелями
52° и 64° с. ш. — стандартный набор для карт России. Страна получается одним
куском, площади сохраняются.

Считает всё этот скрипт, а не браузер: приложению остаётся умножить
координаты на масштаб. Заодно упрощение идёт в километрах, то есть допуск
одинаков по всей стране, а не растягивается к полюсу, как было бы в градусах.

Упрощение без разрывов
----------------------
Обычное прореживание точек каждого контура по отдельности рвёт карту:
общая граница двух соседей упрощается по-разному, и между ними появляется
щель. Поэтому контуры сперва разрезаются на дуги по точкам, где меняется
набор владельцев (тот же приём, что в TopoJSON), каждая дуга упрощается
один раз и достаётся обоим соседям. Общие границы остаются точка в точку.
"""
from __future__ import print_function

import argparse
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "geo", "ne_10m_admin_1_states_provinces.geojson")
OUT = os.path.join(ROOT, "assets", "geo", "russia-regions.json")
NAMES_OUT = os.path.join(ROOT, "assets", "geo", "regions_ru.json")
URL = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
       "master/geojson/ne_10m_admin_1_states_provinces.geojson")

# --- проекция: Альберса, параметры под Россию ---------------------------
LON0, LAT0 = 100.0, 56.0          # центральный меридиан и широта отсчёта
LAT1, LAT2 = 52.0, 64.0           # стандартные параллели
R_KM = 6371.0

# --- вес файла ----------------------------------------------------------
QUANT_KM = 0.4                    # шаг сетки координат, км (1 единица файла)
TOL_KM = 1.2                      # допуск упрощения, км
MIN_AREA_KM2 = 55.0               # острова мельче выкидываем
MAX_KB = 400                      # ориентир по весу, больше — предупреждение

# --- названия -----------------------------------------------------------
# В Natural Earth поле name_ru у республик стоит в разговорной форме
# («Чечня», «Якутия»). Здесь — официальные названия субъектов, как их
# пишет заказчик в отчётах. Ключ — код adm1 из исходника.
NAME_FIX = {
    "RU-AD": "Республика Адыгея",
    "RU-ALT": "Алтайский край",           # в исходнике ошибочно «Республика Алтай»
    "RU-BU": "Республика Бурятия",
    "RU-CE": "Чеченская Республика",
    "RU-CU": "Чувашская Республика",
    "RU-DA": "Республика Дагестан",
    "RU-IN": "Республика Ингушетия",
    "RU-KB": "Кабардино-Балкарская Республика",
    "RU-KC": "Карачаево-Черкесская Республика",
    "RU-KK": "Республика Хакасия",
    "RU-KL": "Республика Калмыкия",
    "RU-KR": "Республика Карелия",
    "RU-ME": "Республика Марий Эл",
    "RU-MO": "Республика Мордовия",
    "RU-SA": "Республика Саха (Якутия)",
    "RU-SE": "Республика Северная Осетия — Алания",
    "RU-TA": "Республика Татарстан",
    "RU-TY": "Республика Тыва",
    "RU-UD": "Удмуртская Республика",
    "RU-ZAB": "Забайкальский край",
    "UA-43": "Республика Крым",
    "UA-40": "Севастополь",
}

# Куски без названия и кода в исходнике — выкидываем.
SKIP = {"RU-X01~"}


# ======================================================================
#  проекция
# ======================================================================

_n = (math.sin(math.radians(LAT1)) + math.sin(math.radians(LAT2))) / 2.0
_C = math.cos(math.radians(LAT1)) ** 2 + 2 * _n * math.sin(math.radians(LAT1))
_rho0 = math.sqrt(_C - 2 * _n * math.sin(math.radians(LAT0))) / _n


def project(lon, lat):
    """Альберса, километры. Долгота заворачивается к центральному меридиану."""
    d = lon - LON0
    while d > 180.0:
        d -= 360.0
    while d <= -180.0:
        d += 360.0
    theta = _n * math.radians(d)
    v = _C - 2 * _n * math.sin(math.radians(lat))
    rho = math.sqrt(v if v > 0 else 0.0) / _n
    x = rho * math.sin(theta)
    y = _rho0 - rho * math.cos(theta)
    # y растёт на север, экрану нужно вниз
    return x * R_KM, -y * R_KM


# ======================================================================
#  упрощение
# ======================================================================

def dp(pts, tol2):
    """Дуглас — Пекер: концы дуги неподвижны."""
    if len(pts) < 3:
        return list(pts)
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        den = dx * dx + dy * dy
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if den == 0:
                d2 = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = ((px - ax) * dx + (py - ay) * dy) / den
                t = 0.0 if t < 0 else (1.0 if t > 1 else t)
                d2 = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d2 > best:
                best, bi = d2, i
        if best > tol2:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


def ring_area(pts):
    """Площадь контура в квадратных единицах (со знаком)."""
    s = 0.0
    for i in range(len(pts) - 1):
        s += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]
    return s / 2.0


# ======================================================================
#  сборка
# ======================================================================

def load_source(path):
    if not os.path.exists(path):
        d = os.path.dirname(path)
        if d and not os.path.exists(d):
            os.makedirs(d)
        print("Качаю Natural Earth admin-1 (около 40 МБ)…")
        try:
            from urllib.request import urlretrieve
        except ImportError:
            from urllib import urlretrieve
        urlretrieve(URL, path)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main(src=None, out=None):
    src = src or SRC
    out = out or OUT
    data = load_source(src)

    feats = []
    for f in data["features"]:
        p = f["properties"]
        if p.get("admin") != "Russia":
            continue
        code = p.get("iso_3166_2") or p.get("adm1_code")
        if code in SKIP or not p.get("name_ru"):
            continue
        feats.append((code, NAME_FIX.get(code) or p["name_ru"], p.get("name"), f["geometry"]))
    if not feats:
        print("ОШИБКА: в исходнике не нашлось ни одного региона России.")
        sys.exit(1)
    print("Регионов в исходнике: %d" % len(feats))

    # 1. проекция и квантование в целую сетку
    q = QUANT_KM
    rings = []            # (индекс региона, индекс полигона, индекс кольца, точки)
    for fi, (_code, _ru, _en, geom) in enumerate(feats):
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        for pi, poly in enumerate(polys):
            for ri, ring in enumerate(poly):
                pts = []
                for lon, lat in ring:
                    x, y = project(lon, lat)
                    pt = (int(round(x / q)), int(round(y / q)))
                    if not pts or pts[-1] != pt:
                        pts.append(pt)
                if len(pts) > 1 and pts[0] != pts[-1]:
                    pts.append(pts[0])
                if len(pts) >= 4:
                    rings.append((fi, pi, ri, pts))

    # 2. кто владеет каждой точкой: по этому режем контуры на дуги
    owner = {}
    for fi, _pi, _ri, pts in rings:
        for pt in pts[:-1]:
            owner.setdefault(pt, set()).add(fi)

    arc_cache = {}        # канонический ключ дуги -> упрощённые точки
    ring_cache = {}       # то же для колец, которые целиком общие
    tol2 = (TOL_KM / q) ** 2

    def simplify_arc(pts):
        """Дуга (кусок границы): упрощаем один раз на обе стороны."""
        key = tuple(pts)
        rev = tuple(reversed(pts))
        flip = rev < key
        ck = rev if flip else key
        if ck not in arc_cache:
            arc_cache[ck] = dp(list(ck), tol2)
        res = arc_cache[ck]
        return list(reversed(res)) if flip else list(res)

    def simplify_ring(pts):
        """Кольцо целиком: приводим к канону (старт с минимальной точки),
        упрощаем один раз. Для заливки старт и направление роли не играют."""
        body = pts[:-1]
        k = min(range(len(body)), key=lambda i: body[i])
        fwd = body[k:] + body[:k]
        bwd = [fwd[0]] + list(reversed(fwd[1:]))
        ck = tuple(min(fwd, bwd))
        if ck not in ring_cache:
            ring_cache[ck] = dp(list(ck) + [ck[0]], tol2)
        return list(ring_cache[ck])

    def process(pts):
        """Режем кольцо на дуги по смене владельцев и упрощаем каждую."""
        body = pts[:-1]
        n = len(body)
        sets = [frozenset(owner[p]) for p in body]
        cuts = [i for i in range(n) if sets[i] != sets[i - 1]]
        if len(cuts) < 2:
            return simplify_ring(pts)
        out_pts = []
        for j, a in enumerate(cuts):
            b = cuts[(j + 1) % len(cuts)]
            seg = []
            i = a
            while True:
                seg.append(body[i])
                if i == b:
                    break
                i = (i + 1) % n
            out_pts.extend(simplify_arc(seg)[:-1])
        if not out_pts:
            return simplify_ring(pts)
        out_pts.append(out_pts[0])
        return out_pts

    # 3. упрощение и отсев мелких островов
    min_area = MIN_AREA_KM2 / (q * q)
    by_poly = {}                       # (fi, pi) -> {ri: точки}
    for fi, pi, ri, pts in rings:
        by_poly.setdefault((fi, pi), {})[ri] = pts

    shaped = [[] for _ in feats]       # fi -> список полигонов, полигон = список колец
    kept_pts = dropped = 0
    for (fi, pi) in sorted(by_poly):
        src_rings = by_poly[(fi, pi)]
        if 0 not in src_rings or abs(ring_area(src_rings[0])) < min_area:
            dropped += len(src_rings)
            continue
        poly = []
        for ri in sorted(src_rings):
            s = process(src_rings[ri])
            if len(s) < 4 or abs(ring_area(s)) < 1:
                dropped += 1
                if ri == 0:
                    poly = []
                    break
                continue
            poly.append(s)
            kept_pts += len(s)
        if poly:
            shaped[fi].append(poly)
    print("Точек после упрощения: %d (выброшено мелких контуров: %d)" % (kept_pts, dropped))

    # 4. общая рамка: сдвигаем в ноль
    xs = [p[0] for f in shaped for poly in f for r in poly for p in r]
    ys = [p[1] for f in shaped for poly in f for r in poly for p in r]
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)

    regions = []
    names = {}
    for fi, (code, ru, en, _g) in enumerate(feats):
        polys = shaped[fi]
        if not polys:
            continue
        names[en] = ru
        out_polys, bx0, by0, bx1, by1 = [], 1 << 30, 1 << 30, -(1 << 30), -(1 << 30)
        big_area, big_ring = -1.0, None
        for poly in polys:
            ring_list = []
            for ri, ring in enumerate(poly):
                pts = [(p[0] - x0, p[1] - y0) for p in ring]
                if ri == 0:
                    a = abs(ring_area(pts))
                    if a > big_area:
                        big_area, big_ring = a, pts
                    for px, py in pts:
                        bx0 = min(bx0, px); by0 = min(by0, py)
                        bx1 = max(bx1, px); by1 = max(by1, py)
                # дельта-кодирование: первая точка целиком, дальше приращения
                flat = [pts[0][0], pts[0][1]]
                for k in range(1, len(pts) - 1):     # замыкающую не пишем
                    flat.append(pts[k][0] - pts[k - 1][0])
                    flat.append(pts[k][1] - pts[k - 1][1])
                ring_list.append(flat)
            out_polys.append(ring_list)

        # точка подписи: центр тяжести самого крупного контура
        cx = cy = 0.0
        if big_ring:
            s = 0.0
            for i in range(len(big_ring) - 1):
                ax, ay = big_ring[i]
                bx, by = big_ring[i + 1]
                cr = ax * by - bx * ay
                s += cr
                cx += (ax + bx) * cr
                cy += (ay + by) * cr
            if abs(s) > 1e-9:
                cx /= 3 * s
                cy /= 3 * s
            else:
                cx, cy = big_ring[0]
        regions.append({
            "id": code,
            "name": ru,
            "en": en,
            "c": [int(round(cx)), int(round(cy))],
            "bbox": [bx0, by0, bx1, by1],
            "polys": out_polys,
        })

    regions.sort(key=lambda r: r["name"])
    doc = {
        "note": "Контуры субъектов РФ. Источник: Natural Earth 10m admin-1 "
                "(public domain). Готовит tools/make_regions.py.",
        "projection": {
            "name": "albers", "lon0": LON0, "lat0": LAT0,
            "lat1": LAT1, "lat2": LAT2, "unitKm": QUANT_KM
        },
        "box": [x1 - x0, y1 - y0],
        "count": len(regions),
        "regions": regions,
    }

    d = os.path.dirname(out)
    if d and not os.path.exists(d):
        os.makedirs(d)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    with open(NAMES_OUT, "w", encoding="utf-8") as f:
        json.dump(names, f, ensure_ascii=False, indent=1, sort_keys=True)

    kb = os.path.getsize(out) / 1024.0
    print("Готово: %s — %d регионов, %.0f КБ" % (os.path.relpath(out, ROOT), len(regions), kb))
    print("Справочник названий: %s" % os.path.relpath(NAMES_OUT, ROOT))
    if kb > MAX_KB:
        print("ВНИМАНИЕ: больше %d КБ — поднимите TOL_KM в начале скрипта." % MAX_KB)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Контуры субъектов РФ из Natural Earth")
    ap.add_argument("--src", help="свой файл ne_10m_admin_1_states_provinces.geojson")
    ap.add_argument("--out", help="куда положить результат")
    args = ap.parse_args()
    main(src=args.src, out=args.out)
