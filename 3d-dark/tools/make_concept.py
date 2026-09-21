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
# Стенд — панель 3840x2160: сцена 1920x1080 растягивается на ней вдвое,
# поэтому потолок ширины — вдвое больше места на экране. Исходники меньше
# потолка не увеличиваются (см. save_webp), так что нынешние картинки
# остаются как есть, а 4K-исходники от дизайнеров пройдут без потерь.
SCENE_W, SCENE_Q = 3840, 78      # сцены во весь экран

# Своё качество у отдельной сцены. Коллаж финала — фотографический,
# а не рендер: на общих 78 он весит вдвое больше соседей, при этом
# небо и лица держатся и на 70.
SCENE_Q_ONE = {"final-collage": 70}
OBJECT_W, OBJECT_Q = 2400, 80    # предметы на прозрачном фоне (альфа остаётся)
CARD_W, CARD_Q = 1800, 82        # снимки внутри карточек (на экране до 514 px, на панели вдвое)

# Снимки, которые лежат в карточках, а не во весь экран: их незачем
# хранить в ширине сцены. Имя файла без расширения.
CARDS = {
    "store-pest", "store-clean", "store-mask-off", "store-mask-on",
    "store-tablet", "store-grate", "store-gas", "store-pest-dead",
    "store-prep-wall",
    "pick-food", "pick-feed", "pick-tech",
    "tile-monitoring", "tile-globe", "tile-regions",
}

# Снимки, которые в макете показаны не целиком, а крупным планом: доля
# исходника (left, top, right, bottom) от 0 до 1. «Очистка хранилища» —
# рабочий с пылесосом; числа пересчитаны из кадра 13-store-4 (картинка
# в карточке 514x205 увеличена до 436 % и сдвинута на -127 % / -286 %).
CARD_CROPS = {
    "store-clean": (0.2918, 0.4599, 0.5211, 0.6209),
    # «Работа на стенке» (кадр 12-store-prep): в карточке 368x172 картинка
    # увеличена до 580 % и сдвинута на -252 % / -305 % — пересчитано в доли
    "store-prep-wall": (0.4337, 0.4368, 0.6058, 0.5799),
}

# Слои, которые в Figma лежат отзеркаленными (поворот на 180° вместе
# с отражением по вертикали даёт зеркало по горизонтали). Чтобы на экране
# кадр выглядел как в макете, их переворачивают при сборке.
#
# Сейчас набор пуст: единственный такой слой — коллаж финала — заменён
# исходником заказчика от 22.09, он уже в правильной ориентации.
# Механизм оставлен: следующий зеркальный слой достаточно вписать сюда.
FLIP_H = set()

# Куски, которые вырезаем из полных кадров макетов.
# Каждая строка: кадр, прямоугольник (left, top, right, bottom) в пикселях
# кадра 1920x1080, имя результата, ширина и качество WebP.
CROPS = [
    # Заставка: коллаж из фотографий вокруг зерна. Снизу обрезаем выше
    # заголовка «ЗЕРНО В ОСНОВЕ ВСЕГО» — он будет набран текстом.
    ("01-intro.png", (233, 112, 1585, 862), "intro-collage", 1600, 78),
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
CLEANS = []


def trim_edges(im):
    """Срезает бракованную кромку в 1 px.

    Слои из Figma иногда приходят со светлой (или тёмной) крайней строкой
    или столбцом — след сглаживания при выгрузке. На экране это даёт
    тонкую полосу по краю кадра. Кромку срезаем, только если она заметно
    отличается по яркости от соседних строк.
    """
    rgb = im.convert("RGB")
    w, h = rgb.size

    def lum(points):
        vals = [rgb.getpixel(p) for p in points]
        return sum(c[0] * 3 + c[1] * 6 + c[2] for c in vals) / (10.0 * len(vals))

    xs = range(0, w, max(1, w // 80))
    ys = range(0, h, max(1, h // 80))
    left = 1 if abs(lum([(0, y) for y in ys]) - lum([(3, y) for y in ys])) > 25 else 0
    right = 1 if abs(lum([(w - 1, y) for y in ys]) - lum([(w - 4, y) for y in ys])) > 25 else 0
    top = 1 if abs(lum([(x, 0) for x in xs]) - lum([(x, 3) for x in xs])) > 25 else 0
    bottom = 1 if abs(lum([(x, h - 1) for x in xs]) - lum([(x, h - 4) for x in xs])) > 25 else 0
    if left or right or top or bottom:
        im = im.crop((left, top, w - right, h - bottom))
    return im


def save_webp(im, name, width, quality, alpha):
    """Ужимает картинку до нужной ширины и сохраняет в WebP."""
    im = trim_edges(im)
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

    stem = os.path.splitext(name)[0]
    if stem == "seed-1-scene":
        # В кадре 07 этот слой перевёрнут по вертикали и размыт на 125 px,
        # стоит со сдвигом (-50, -51) при размере 1988x1143 на фоне #0c1813.
        # Эффекты запекаем в картинку: без них виден прямоугольный шов
        # и блик в углу. Результат — ровно блок сцены 1888x1048.
        from PIL import ImageFilter, ImageOps
        pad, k = 400, 4
        layer = ImageOps.flip(im.convert("RGB").resize((1988, 1143), Image.LANCZOS))
        canvas = Image.new("RGB", (1988 + 2 * pad, 1143 + 2 * pad), (0x0c, 0x18, 0x13))
        canvas.paste(layer, (pad, pad))
        small = canvas.resize((canvas.width // k, canvas.height // k), Image.BILINEAR)
        small = small.filter(ImageFilter.GaussianBlur(125.0 / k))
        canvas = small.resize(canvas.size, Image.BICUBIC)
        im = canvas.crop((pad + 50, pad + 51, pad + 50 + 1888, pad + 51 + 1048))
        return save_webp(im, stem, SCENE_W, 82, False)
    if stem in FLIP_H:
        from PIL import ImageOps
        im = ImageOps.mirror(im)
    if stem in CARD_CROPS:
        l, t, r, b = CARD_CROPS[stem]
        im = im.crop((round(l * im.width), round(t * im.height),
                      round(r * im.width), round(b * im.height)))
        # кусок мелкий, а карточка на экране 514 px: растягиваем вдвое
        # с запасом, чтобы браузер не мылил его сам
        im = im.resize((1028, round(1028 * im.height / im.width)), Image.LANCZOS)
    if stem in CARDS:
        width, quality = CARD_W, CARD_Q
    elif im.width >= 1600:
        width, quality = SCENE_W, SCENE_Q_ONE.get(stem, SCENE_Q)
    else:
        width, quality = OBJECT_W, OBJECT_Q
    return save_webp(im, stem, width, quality, alpha)


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
