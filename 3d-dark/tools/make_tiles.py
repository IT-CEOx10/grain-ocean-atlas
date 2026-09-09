# -*- coding: utf-8 -*-
"""Сжимает изометрические плитки экрана «Путь зерна».

Исходники — большие PNG с прозрачным фоном в assets/tiles/ (1254x1254,
примерно по 1,8 МБ каждый). В приложении они не нужны: на экране плитка
занимает не больше 400 px, а в собранный один файл картинки попадают
как base64, то есть весят на треть больше.

Скрипт кладёт рядом уменьшенные копии в WebP с прозрачностью:

    assets/tiles/web/01-wheat.webp  и так далее

Оригиналы не трогаются — их держим как исходники, чтобы можно было
пересжать с другими настройками.

Запуск:  python3 tools/make_tiles.py
Нужен только PIL (Pillow), как и остальным инструментам проекта.
"""
from __future__ import print_function

import os
import sys

try:
    from PIL import Image
except ImportError:
    print("Нужен Pillow:  pip3 install pillow")
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "tiles")
OUT = os.path.join(SRC, "web")

# Ширина копии. На экране самая крупная плитка — 380 px, но панель показывают
# на ретине (кадр рисуется в двойном разрешении), поэтому берём запас.
WIDTH = 900
QUALITY = 86          # 82-88: ниже начинают мылиться зёрна и колосья
METHOD = 6            # 0-6, чем больше, тем дольше жмёт и меньше файл


def main():
    if not os.path.isdir(SRC):
        print("ОШИБКА: нет папки %s" % SRC)
        sys.exit(1)
    if not os.path.exists(OUT):
        os.makedirs(OUT)

    names = sorted(n for n in os.listdir(SRC) if n.lower().endswith(".png"))
    if not names:
        print("ОШИБКА: в %s нет ни одного PNG" % SRC)
        sys.exit(1)

    total_src = total_out = 0
    for name in names:
        src = os.path.join(SRC, name)
        dst = os.path.join(OUT, os.path.splitext(name)[0] + ".webp")

        im = Image.open(src).convert("RGBA")
        # Кадр не обрезаем: у всех шести картинок постамент стоит на одном
        # месте, и обрезка по содержимому развалила бы эту общую сетку.
        if im.width != WIDTH:
            h = int(round(im.height * WIDTH / float(im.width)))
            im = im.resize((WIDTH, h), Image.LANCZOS)
        im.save(dst, "WEBP", quality=QUALITY, method=METHOD, exact=False)

        a, b = os.path.getsize(src), os.path.getsize(dst)
        total_src += a
        total_out += b
        print("%-20s %6.0f КБ -> %6.0f КБ  (%dx%d)"
              % (name, a / 1024.0, b / 1024.0, im.width, im.height))

    print("-" * 52)
    print("Итого: %.1f МБ -> %.1f МБ, файлы в %s"
          % (total_src / 1048576.0, total_out / 1048576.0,
             os.path.relpath(OUT, ROOT)))


if __name__ == "__main__":
    main()
