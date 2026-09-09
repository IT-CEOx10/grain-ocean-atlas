# -*- coding: utf-8 -*-
"""Демонстрационные данные госмониторинга пшеницы для экрана «Мониторинг зерна РФ».

    python3 tools/make_monitoring.py

Кладёт data/monitoring.json: по каждому субъекту РФ и каждому году с 2020
по 2026 — валовой сбор, объём обследования, число проб, доля соответствия
требованиям, распределение по классам и четыре показателя качества.

ЦИФРЫ ВЫДУМАНЫ. Названия субъектов настоящие, порядок величин взят из
открытой статистики (лидеры — Ростовская область, Краснодарский и
Ставропольский края), но сами значения сгенерированы этим скриптом.
На экране это написано прямым текстом внизу.

Когда заказчик пришлёт свои цифры, менять код не нужно: достаточно
положить на место data/monitoring.json файл той же структуры
и пересобрать dist. Структура описана в README, раздел про мониторинг.
"""
from __future__ import print_function

import json
import os
import random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO = os.path.join(ROOT, "assets", "geo", "russia-regions.json")
OUT = os.path.join(ROOT, "data", "monitoring.json")

YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026]
SEED = 20260901
UPDATED = {2020: "18.12.2020", 2021: "20.12.2021", 2022: "16.12.2022",
           2023: "19.12.2023", 2024: "17.12.2024", 2025: "18.12.2025",
           2026: "01.09.2026"}

# урожайные и неурожайные годы: множитель к валовому сбору по стране
YEAR_K = {2020: 1.02, 2021: 0.87, 2022: 1.19, 2023: 1.06,
          2024: 0.94, 2025: 1.00, 2026: 0.97}

# Валовой сбор пшеницы по субъектам, тыс. т — опорный уровень «среднего года».
# Ключ — код субъекта из assets/geo/russia-regions.json.
BASE = {
    # юг
    "RU-ROS": 11500, "RU-KDA": 10600, "RU-STA": 8700, "RU-VGG": 4300,
    "UA-43": 1250, "RU-KL": 800, "RU-DA": 340, "RU-AD": 320, "RU-CE": 230,
    "RU-KB": 210, "RU-KC": 130, "RU-SE": 90, "RU-IN": 70, "UA-40": 55,
    "RU-AST": 45,
    # центр
    "RU-VOR": 4100, "RU-KRS": 3300, "RU-TAM": 2350, "RU-ORL": 2150,
    "RU-BEL": 2000, "RU-LIP": 1950, "RU-TUL": 1850, "RU-RYA": 1750,
    "RU-BRY": 700, "RU-MOW": 380, "RU-VLA": 210, "RU-KLU": 200,
    "RU-SMO": 150, "RU-IVA": 130, "RU-TVE": 130, "RU-YAR": 110,
    "RU-KOS": 60, "RU-MOS": 0, "RU-SPE": 0,
    # Поволжье и Урал
    "RU-SAR": 3600, "RU-ORE": 2300, "RU-TA": 2100, "RU-SAM": 1900,
    "RU-BA": 1800, "RU-PNZ": 1700, "RU-KGN": 1350, "RU-CHE": 1250,
    "RU-ULY": 1100, "RU-NIZ": 1000, "RU-TYU": 900, "RU-MO": 850,
    "RU-SVE": 550, "RU-CU": 450, "RU-PER": 420, "RU-KIR": 380,
    "RU-UD": 340, "RU-ME": 250, "RU-KHM": 8, "RU-YAN": 0,
    # Сибирь
    "RU-ALT": 3000, "RU-OMS": 2600, "RU-KYA": 1900, "RU-NVS": 1700,
    "RU-KEM": 900, "RU-IRK": 700, "RU-TOM": 250, "RU-KK": 130,
    "RU-ZAB": 90, "RU-AL": 60, "RU-BU": 60, "RU-TY": 25,
    # Дальний Восток
    "RU-AMU": 180, "RU-PRI": 60, "RU-YEV": 25, "RU-KHA": 12, "RU-SA": 6,
    "RU-SAK": 2, "RU-KAM": 1, "RU-MAG": 0, "RU-CHU": 0,
    # Северо-Запад
    "RU-KGD": 480, "RU-PSK": 120, "RU-VLG": 90, "RU-LEN": 90,
    "RU-NGR": 60, "RU-ARK": 10, "RU-KO": 3, "RU-KR": 2,
    "RU-MUR": 0, "RU-NEN": 0,
}

# Где сеют твёрдую пшеницу и какую долю посевов она занимает.
DURUM = {
    "RU-ALT": 0.13, "RU-ORE": 0.08, "RU-SAR": 0.06, "RU-VGG": 0.04,
    "RU-CHE": 0.05, "RU-OMS": 0.04, "RU-ROS": 0.02, "RU-STA": 0.02,
    "RU-KDA": 0.01, "RU-SAM": 0.05, "RU-KGN": 0.03, "RU-NVS": 0.03,
    "RU-KL": 0.03, "UA-43": 0.02,
}

# Юг даёт более сильное зерно: сдвиг распределения по классам к 3-му.
SOUTH = {"RU-ROS", "RU-KDA", "RU-STA", "RU-VGG", "UA-43", "UA-40", "RU-KL",
         "RU-AD", "RU-CE", "RU-KB", "RU-KC", "RU-SE", "RU-IN", "RU-DA",
         "RU-AST", "RU-SAR", "RU-ORE"}
SIBERIA = {"RU-ALT", "RU-OMS", "RU-NVS", "RU-KYA", "RU-KEM", "RU-IRK",
           "RU-TOM", "RU-KK", "RU-AL", "RU-TY", "RU-BU", "RU-ZAB",
           "RU-KGN", "RU-CHE", "RU-TYU"}


def rnd(rg, a, b, digits=1):
    return round(rg.uniform(a, b), digits)


def classes_for(rg, code):
    """Доли классов 2–5 в процентах, в сумме 100."""
    if code in SOUTH:
        raw = [rg.uniform(0.4, 3.4), rg.uniform(30, 46),
               rg.uniform(34, 48), rg.uniform(8, 18)]
    elif code in SIBERIA:
        raw = [rg.uniform(0.2, 2.2), rg.uniform(26, 40),
               rg.uniform(38, 52), rg.uniform(10, 22)]
    else:
        raw = [rg.uniform(0.0, 1.4), rg.uniform(14, 30),
               rg.uniform(40, 56), rg.uniform(18, 34)]
    s = sum(raw)
    out = [round(v * 100.0 / s, 1) for v in raw]
    out[2] = round(out[2] + (100.0 - sum(out)), 1)      # добираем до ровных 100
    return out


def quality_for(rg, code):
    """Влажность, клейковина, натура, стекловидность."""
    south = code in SOUTH
    return {
        "moisture": rnd(rg, 11.4, 13.4 if south else 14.2),
        "gluten": rnd(rg, 22.0 if south else 18.5, 29.5 if south else 25.0),
        "nature": int(rg.uniform(762 if south else 740, 806 if south else 790)),
        "vitreous": int(rg.uniform(48 if south else 34, 68 if south else 56)),
    }


def block(rg, code, gross, year, durum_share=0.0):
    """Один год по одному виду пшеницы."""
    if gross <= 0:
        return None
    # охват обследованием растёт год от года
    share = 0.61 + 0.032 * (year - 2020) + rg.uniform(-0.06, 0.06)
    share = max(0.35, min(0.94, share))
    surveyed = gross * share
    if durum_share:
        surveyed *= durum_share
        gross = gross * durum_share
    cls = classes_for(rg, code)
    q = quality_for(rg, code)
    q.update({
        "gross": round(gross, 1),
        "surveyed": round(surveyed, 1),
        # одна объединённая проба примерно на 340 т зерна, счёт в тысячах
        "samples": round(surveyed / 340.0, 2),
        "compliance": round(rg.uniform(94.2, 99.6), 1),
        "classes": cls,
        "updated": UPDATED[year],
    })
    return q


def main():
    with open(GEO, encoding="utf-8") as f:
        geo = json.load(f)
    codes = [(r["id"], r["name"]) for r in geo["regions"]]
    missing = [c for c, _ in codes if c not in BASE]
    if missing:
        print("ВНИМАНИЕ: нет опорного объёма для %s — поставлю ноль"
              % ", ".join(missing))

    regions = []
    for code, name in codes:
        rg = random.Random("%s|%d" % (code, SEED))
        base = float(BASE.get(code, 0))
        years = {}
        for y in YEARS:
            gross = base * YEAR_K[y] * rg.uniform(0.86, 1.14)
            soft = block(rg, code, gross, y)
            if not soft:
                continue
            item = {"soft": soft}
            ds = DURUM.get(code)
            if ds:
                item["durum"] = block(rg, code, gross, y, durum_share=ds)
            years[str(y)] = item
        regions.append({"id": code, "name": name, "years": years})

    # сводка по стране: суммы по регионам, соответствие — средневзвешенное
    russia = {}
    for y in YEARS:
        ys = str(y)
        gross = surveyed = samples = 0.0
        comp = 0.0
        cls = [0.0, 0.0, 0.0, 0.0]
        for r in regions:
            b = (r["years"].get(ys) or {}).get("soft")
            if not b:
                continue
            gross += b["gross"]
            surveyed += b["surveyed"]
            samples += b["samples"]
            comp += b["compliance"] * b["surveyed"]
            for i in range(4):
                cls[i] += b["classes"][i] * b["surveyed"] / 100.0
        top = sorted(regions, key=lambda r: -((r["years"].get(ys) or {})
                                              .get("soft", {}).get("surveyed", 0)))
        russia[ys] = {
            "gross": round(gross, 1),
            "surveyed": round(surveyed, 1),
            "samples": round(samples, 1),
            "compliance": round(comp / surveyed, 1) if surveyed else 0,
            "classes": [round(c * 100.0 / surveyed, 1) for c in cls] if surveyed else [0, 0, 0, 0],
            "regions": len([r for r in regions if (r["years"].get(ys) or {}).get("soft")]),
            "leader": top[0]["name"] if top else "",
            "updated": UPDATED[y],
        }

    doc = {
        "demo": True,
        "note": "ДЕМОНСТРАЦИОННЫЕ ДАННЫЕ. Названия субъектов настоящие, "
                "числа сгенерированы tools/make_monitoring.py и будут "
                "заменены статистикой заказчика.",
        "unit": "тыс. т",
        "years": YEARS,
        "russia": russia,
        "regions": regions,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))

    kb = os.path.getsize(OUT) / 1024.0
    print("Готово: %s — %d субъектов, годы %d–%d, %.0f КБ"
          % (os.path.relpath(OUT, ROOT), len(regions), YEARS[0], YEARS[-1], kb))
    for y in YEARS:
        r = russia[str(y)]
        print("  %d: обследовано %8.0f тыс. т, соответствует %.1f %%, проб %.1f тыс."
              % (y, r["surveyed"], r["compliance"], r["samples"]))


if __name__ == "__main__":
    main()
