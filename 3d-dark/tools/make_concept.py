#!/usr/bin/env python3
"""Готовит картинки нового дизайна («Design concept 17.09»).

Две задачи. Первая: берёт готовые сцены из assets/concept/src, сжимает
в WebP и кладёт в assets/photos/concept. Вторая: вырезает из полных
кадров макетов (assets/concept/frames, 1920x1080) отдельные куски —
коллаж на заставке и картинки из плиток — чтобы верстать их как
самостоятельные изображения, а текст поверх рисовать шрифтом.

Запуск:  python3 tools/make_concept.py

Чтобы заменить картинку, положите новый файл в src под тем же именем
и запустите скрипт заново.
"""

import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "concept", "src")
FRAMES = os.path.join(ROOT, "assets", "concept", "frames")
OUT = os.path.join(ROOT, "assets", "photos", "concept")

# Ширина готового файла и качество WebP.
#
# Сцены из фигмы выгружены шириной 1888 px, а на экране стенда лежат во
# всю ширину 1920 px. Уменьшать их нельзя: растянутая обратно картинка
# мылит изометрию, поэтому ширину оставляем исходной (SCENE_W больше
# любого исходника, так что ресайза не происходит) и экономим качеством.
SCENE_W, SCENE_Q = 1920, 72      # сцены во весь экран
OBJECT_W, OBJECT_Q = 1200, 78    # предметы на прозрачном фоне (альфа остаётся)

# Куски, которые вырезаем из полных кадров макетов.
# Каждая строка: кадр, прямоугольник (left, top, right, bottom) в пикселях
# кадра 1920x1080, имя результата, ширина и качество WebP.
CROPS = [
    # Заставка: коллаж из фотографий вокруг зерна. Снизу обрезаем выше
    # заголовка «ЗЕРНО В ОСНОВЕ ВСЕГО» — он будет набран текстом.
    # Сам коллаж занимает 248..1569 по ширине и 127..844 по высоте,
    # берём его с запасом ~15 px; заголовок начинается с y=915.
    ("01-intro.png", (233, 112, 1585, 862), "intro-collage", 1600, 78),
    # Экран развилки: картинки внутри трёх плиток справа внизу,
    # без подписей и без рамки самой плитки.
    ("02-start.png", (806, 746, 1139, 928), "tile-monitoring", 560, 80),
    ("02-start.png", (1167, 746, 1481, 928), "tile-globe", 560, 80),
    ("02-start.png", (1509, 746, 1840, 928), "tile-regions", 560, 80),
    # Экран «Сохранение и восстановление земельного ресурса»: картинки
    # внутри двух карточек выбора удобрения, без подписей и без рамки.
    ("06-soil-2.png", (68, 455, 336, 641), "soil-2-mineral", 560, 82),
    ("06-soil-2.png", (352, 455, 618, 641), "soil-2-organic", 560, 82),
]

# Сцены, которые приходится доставать из готового кадра макета.
#
# Для экрана «Сохранение и восстановление земельного ресурса» чистой сцены
# дизайнеры не отдали: изометрическое поле есть только на кадре, поверх
# которого уже нарисован интерфейс. Поэтому берём кадр целиком и затираем
# места, где лежат панели, кнопки и заголовок: в нашей вёрстке ровно там
# же встанут свои. Затирка — плавная растяжка соседних пикселей, шва
# не видно, а под нашими панелями это место всё равно закрыто.
#
# Прямоугольники — в координатах экрана 1920x1080 (кадр выше на BAND).
CLEANS = [
    {
        "frame": "06-soil-2.png",
        "band": (0, 62, 1920, 1142),      # сам экран внутри кадра с подписями
        "name": "soil-2-scene",
        "width": 1920,
        "quality": 72,
        "rects": [
            # (прямоугольник, направление растяжки)
            ((56, 55, 1400, 185), "v"),    # надзаголовок и заголовок
            ((1548, 56, 1862, 178), "v"),  # кнопка «В Центр»
            ((40, 55, 624, 1025), "v"),    # вся левая колонка: фон ровный
            ((1450, 193, 1856, 595), "h"), # панели справа лежат на поле,
                                           # поэтому тянем вбок, от поля к фону
            ((1368, 900, 1862, 1023), "v"),  # «Семена и посевы →»
        ],
    },
]


def save_webp(im, name, width, quality, alpha):
    """Ужимает картинку до нужной ширины и сохраняет в WebP."""
    if im.width > width:
        height = round(im.height * width / im.width)
        im = im.resize((width, height), Image.LANCZOS)

    im = im.convert("RGBA" if alpha else "RGB")
    out = os.path.join(OUT, name + ".webp")
    im.save(out, "WEBP", quality=quality, method=6)
    return out, os.path.getsize(out)


def convert(name):
    """Готовая сцена из src.

    Прозрачность сохраняем там, где она есть на самом деле: у части сцен
    (например, острова Центра) фон вырезан, и подложкой служит цвет темы.
    Широкие кадры считаем сценами и оставляем в исходном размере,
    маленькие — предметными снимками.
    """
    im = Image.open(os.path.join(SRC, name))
    alpha = im.mode in ("RGBA", "LA") and im.getchannel("A").getextrema()[0] < 255

    scene = im.width >= 1600
    width, quality = (SCENE_W, SCENE_Q) if scene else (OBJECT_W, OBJECT_Q)
    return save_webp(im, os.path.splitext(name)[0], width, quality, alpha)


def crop(frame, box, name, width, quality):
    """Кусок полного кадра макета: фон всегда непрозрачный."""
    im = Image.open(os.path.join(FRAMES, frame)).convert("RGB")
    return save_webp(im.crop(box), name, width, quality, False)


def wipe(im, rect, way):
    """Затирает прямоугольник растяжкой соседних пикселей.

    way = 'v' — плавный переход сверху вниз между строками у краёв;
    way = 'h' — то же слева направо. Фон у макетов гладкий, поэтому
    шва не остаётся; направление выбирают так, чтобы в затирку не
    попала яркая картинка (иначе она размажется полосами).
    """
    x1, y1, x2, y2 = rect
    px = im.load()
    w, h = x2 - x1, y2 - y1

    if way == "h":
        left = [px[max(x1 - 1, 0), y] for y in range(y1, y2)]
        right = [px[min(x2, im.width - 1), y] for y in range(y1, y2)]
        for j in range(h):
            for i in range(w):
                f = (i + 1) / (w + 1)
                px[x1 + i, y1 + j] = tuple(
                    round(left[j][c] * (1 - f) + right[j][c] * f) for c in range(3))
        return

    top = [px[x, max(y1 - 1, 0)] for x in range(x1, x2)]
    bottom = [px[x, min(y2, im.height - 1)] for x in range(x1, x2)]
    for j in range(h):
        f = (j + 1) / (h + 1)
        for i in range(w):
            px[x1 + i, y1 + j] = tuple(
                round(top[i][c] * (1 - f) + bottom[i][c] * f) for c in range(3))


def clean(spec):
    """Сцена из кадра макета: вырезаем экран и убираем с него интерфейс."""
    im = Image.open(os.path.join(FRAMES, spec["frame"])).convert("RGB")
    im = im.crop(spec["band"])
    for rect, way in spec["rects"]:
        wipe(im, rect, way)
    return save_webp(im, spec["name"], spec["width"], spec["quality"], False)


def main():
    if not os.path.isdir(SRC):
        sys.exit("нет папки с исходниками: %s" % SRC)
    os.makedirs(OUT, exist_ok=True)

    total = 0
    count = 0

    names = sorted(n for n in os.listdir(SRC) if n.lower().endswith((".png", ".jpg", ".jpeg")))
    for name in names:
        out, size = convert(name)
        total += size
        count += 1
        print("%-34s %6.0f КБ" % (os.path.basename(out), size / 1024))

    if os.path.isdir(FRAMES):
        print()
        for frame, box, name, width, quality in CROPS:
            if not os.path.exists(os.path.join(FRAMES, frame)):
                print("%-34s нет кадра %s" % (name, frame))
                continue
            out, size = crop(frame, box, name, width, quality)
            total += size
            count += 1
            print("%-34s %6.0f КБ" % (os.path.basename(out), size / 1024))

        for spec in CLEANS:
            if not os.path.exists(os.path.join(FRAMES, spec["frame"])):
                print("%-34s нет кадра %s" % (spec["name"], spec["frame"]))
                continue
            out, size = clean(spec)
            total += size
            count += 1
            print("%-34s %6.0f КБ" % (os.path.basename(out), size / 1024))

    print("\nготово: %d файлов, %.1f МБ" % (count, total / 1048576))


if __name__ == "__main__":
    main()
