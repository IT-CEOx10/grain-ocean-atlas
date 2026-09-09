#!/usr/bin/env python3
"""Готовит фотографии для презентации «Путь зерна».

Берёт исходники из assets/photos/src, сжимает в WebP и кладёт рядом,
в assets/photos. Предметные снимки с прозрачным фоном остаются
прозрачными, широкие сцены сохраняются без альфы и весят меньше.

Запуск:  python3 tools/make_photos.py

Чтобы заменить фотографию, положите новый файл в src под тем же именем
и запустите скрипт заново.
"""

import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "photos", "src")
OUT = os.path.join(ROOT, "assets", "photos")

# Ширина готового файла и качество WebP.
# Подобраны так, чтобы все фотографии вместе весили около 3,5 МБ:
# в dist они вшиваются как base64 и прибавляют ещё треть, а вся
# сборка dist/story.html должна оставаться в пределах 6 МБ.
SCENE_W, SCENE_Q = 1152, 74      # широкие сцены 16:9
OBJECT_W, OBJECT_Q = 820, 78     # предметы на прозрачном фоне

# Отдельные правила для квадратных кадров: на экране они занимают
# меньше места, чем широкие сцены, и большая ширина им не нужна.
OVERRIDES = {
    "bread-q1": (860, 72), "bread-q2": (860, 72), "bread-q3": (860, 72),
    "bread-q4": (860, 72), "bread-q5": (860, 72),
    "soil-before": (1000, 70), "soil-after": (1000, 70),
}


def convert(name):
    path = os.path.join(SRC, name)
    im = Image.open(path)
    alpha = im.mode in ("RGBA", "LA") and im.getchannel("A").getextrema()[0] < 255

    width, quality = (OBJECT_W, OBJECT_Q) if alpha else (SCENE_W, SCENE_Q)
    width, quality = OVERRIDES.get(os.path.splitext(name)[0], (width, quality))
    if im.width > width:
        height = round(im.height * width / im.width)
        im = im.resize((width, height), Image.LANCZOS)

    im = im.convert("RGBA" if alpha else "RGB")
    out = os.path.join(OUT, os.path.splitext(name)[0] + ".webp")
    im.save(out, "WEBP", quality=quality, method=6)
    return out, os.path.getsize(out)


def main():
    if not os.path.isdir(SRC):
        sys.exit("нет папки с исходниками: %s" % SRC)
    os.makedirs(OUT, exist_ok=True)

    total = 0
    names = sorted(n for n in os.listdir(SRC) if n.lower().endswith((".png", ".jpg", ".jpeg")))
    for name in names:
        out, size = convert(name)
        total += size
        print("%-34s %6.0f КБ" % (os.path.basename(out), size / 1024))

    print("\nготово: %d файлов, %.1f МБ" % (len(names), total / 1048576))


if __name__ == "__main__":
    main()
