#!/usr/bin/env python3
"""Скачивает чистые слои кадров из Figma Desktop и раскладывает по именам.

Плагин Figma отдаёт слои по адресам вида
http://localhost:3845/assets/<hash>.png|svg, пока открыт файл макетов.
Соответствие «хеш → имя» снято с выгрузки docs/mockup/concept-18-09/*.code.txt
(в ней у каждого слоя есть имя и координаты).

Запуск:  python3 tools/fetch_figma.py
Потом:   python3 tools/make_concept.py   — сожмёт PNG в WebP.

PNG кладутся в assets/concept/src (оттуда их берёт make_concept.py),
SVG — сразу в assets/concept/svg, они идут в сборку как есть.
"""

import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "concept", "src")
SVG = os.path.join(ROOT, "assets", "concept", "svg")
BASE = "http://localhost:3845/assets/"

# Сцены во весь кадр и предметные снимки. Имя = имя файла без расширения.
PNG = {
    # заставка и меню
    "intro-scene": "a83dfdc611fcc37a476e49b9b8b376d4aca8dc86",
    "start-scene": "4265130b2bbfb60e87cdf54e9d0ea8020ac860c4",
    "tile-monitoring": "9964469e6ee73fa4a992c1fe52244b01afe8f9f3",
    "tile-globe": "f433187f8f2c0cf5c75508d6ea8ae62bac8ff8c3",
    "tile-regions": "4b2f27972f429f8c2bc4d821271a1af4b2d7583a",
    # центр
    "hub-scene": "2fcb6bb508987ef9fa69583911e4cf0d904ca176",
    # почва
    "soil-1-scene": "2cd4e254c9124ef865081e741ccf9d312afe2422",
    "soil-2-scene": "911a3f50f0a4f8111480848b1d46fb8be98153d9",
    # семена
    "seed-1-scene": "44c43498e49ca757a9289c0c4e9278264a6aadfc",
    "seed-1-grain-bad": "6dac4367ee46c644c6afdebea0691cf85321de28",
    "seed-1-grain-ok": "e12b886b537bac2b1d30bc9e31367077eb3d01ff",
    "seed-2-scene": "1af2b31dd6d06727222b076e8c03b92fc37b5cb6",
    "seed-3-iso": "ff6d807d39f80100267a019f045b3fc15b97a9ec",
    "seed-3-photo": "502942577998108db47c440054024becfb824db5",
    "seed-3-drone": "87f791a827787337798520ec52bc90ca739d3f7f",
    # качество
    "quality-1-scene": "3a38367960cb0d9d7d8631213bd090b53e528260",
    "quality-2-scene": "7ebfc5a692b6383d7d5d3b82883a6d53fcf5ae9e",
    # хранение: одна сцена на все шаги и своя на шаг очистки
    "store-scene": "506380426a70af5dfd27837f96dfe0642710bd1f",
    "store-scene-clean": "4b253fdcdbf8e8026f967f60f512cccd9e80fba7",
    "store-pest": "01237ae3cd16de18c153e4fa706ac359da000030",
    "store-clean": "9d07ececd83062d6e452e3f212df6efe94268458",
    "store-mask-off": "a7d26b9d20fd191516957209dfe279412c86afc4",
    "store-mask-on": "1452e09c9dc6929db48b8bea9bc6947bcc132c2b",
    "store-tablet": "de437f6c94b4e89e0f0a56322129395ecf39ff5f",
    "store-grate": "6688707901fc61e58821b04657009276bcfd3806",
    "store-gas": "420c1b0210da67e20ed8fd67f5071e735a1c3bbb",
    "store-pest-dead": "de60e1902fd625654a08c85d3bb432b0a3fc9225",
    # развилка маршрутов
    "pick-food": "162432965365b6004c8360ad71049d89a3904d52",
    "pick-feed": "764ed2d63474d72584fc5f34ef412a4e0d48f6c6",
    "pick-tech": "998f9941f1d50df3d297110c98d889208c0458b7",
    # продовольственный маршрут
    "food-flour": "95f5d31840910ef1d6deb56070de99bece24c69e",
    "food-groats": "e70cfa970ba4a2b8663c6ea814a24e587bcaf09d",
    "food-flakes": "839814133e6018630755d7c30714da05ab419a7e",
    "food-oil": "c5c2820e7ccc6f5e4097bd2123b246fa128d87f5",
    # кормовой маршрут, биотопливо, продукция
    "feed-1-scene": "bd21e5345d01a52e4bbea72de58973bcfabf57e0",
    "feed-2-scene": "7de0fb638728ff9885844a9ba839d7f8e2accef5",
    "fuel-scene": "683878681dd115f345a3547b00270eaad0d06553",
    "product-scene": "56813aff446250be86e13202c7ca42a03ba69088",
    # экспорт и финал
    "export-1-scene": "a7b7b580f032d20dfda0fe61461470569ae8e474",
    "export-2-scene": "f5edd4d16a9b356c7c2538c2e8136562c74fb248",
    "final-1": "0d0827feb297dbc9ff522f2a4b285c0d2a3b5931",
}

# Векторные детали: линии между станциями, подсветки, иконки.
SVGS = {
    # иконки направлений исследования семян (кадр 07)
    "ico-science": "31f252f735eae93dc73f72984e328168b6625d66",
    "ico-mushroom": "8ac60e9f81f5dd11083c5ff8a2f91a03b20a62e7",
    "ico-drop": "61a81a750c8c53b7a9a0ea143cf99264da52f9cc",
    "ico-eco": "f2834f2a3bb58fa09e56daad01a8ebd276060f57",
    "ico-ant": "a93f5b0001d9b828bb8c5418bd0b471c04aa2a19",
    # подсветки на ангаре: пол под препарат, решётка, поток воздуха
    "store-floor": "28bc90efe1bbdfab076049ac286c8fa8d505253e",
    "store-grate-mark": "0d573fba3da2729b9d063e45910f37ac9df5b491",
    "store-air-1": "d02d369e66c9f59f142d427331c303e08247fba1",
    "store-air-2": "d36885b6158e1b41e89ca70607e1082565900361",
}


def fetch(url, path):
    with urllib.request.urlopen(url, timeout=30) as r:
        data = r.read()
    with open(path, "wb") as f:
        f.write(data)
    return len(data)


def main():
    os.makedirs(SRC, exist_ok=True)
    os.makedirs(SVG, exist_ok=True)
    total = 0
    for group, ext, out in ((PNG, "png", SRC), (SVGS, "svg", SVG)):
        for name, h in group.items():
            path = os.path.join(out, name + "." + ext)
            try:
                size = fetch(BASE + h + "." + ext, path)
            except Exception as e:                      # noqa: BLE001
                print("%-22s не скачался: %s" % (name, e))
                continue
            total += size
            print("%-22s %7.0f КБ" % (name, size / 1024))
    print("\nготово, %.1f МБ" % (total / 1048576))


if __name__ == "__main__":
    main()
