# -*- coding: utf-8 -*-
"""Готовит текстуры глобуса из снимков NASA.

Оригиналы NASA лежат рядом и не меняются:

  assets/textures/nasa_black_marble_4096.jpg  — Black Marble 2016, ночные огни
  assets/textures/nasa_blue_marble_2048.jpg   — Blue Marble Next Generation, день

Скрипт делает из них две рабочие текстуры:

  assets/textures/earth_night_4096.jpg  — огни городов для emissive:
      города остаются как есть, а синеватая ночная дымка над сушей и океаном
      обесцвечивается и гасится, иначе тёплый цвет огней красит материки
      в фиолетовый;
  assets/textures/earth_land_2048.jpg   — подложка суши для diffuse:
      обесцвеченный и притушенный дневной снимок, остаётся намёк на рельеф
      и очертания материков, без ярких голубых океанов и зелёной суши.
      Цвет ей задаёт `colors.land` из config.json.

Запуск:  python3 tools/make_earth_textures.py
"""
from __future__ import print_function

import os

from PIL import Image, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX = os.path.join(ROOT, "assets", "textures")

SRC_NIGHT = os.path.join(TEX, "nasa_black_marble_4096.jpg")
OUT_NIGHT = os.path.join(TEX, "earth_night_4096.jpg")
SRC_LAND = os.path.join(TEX, "nasa_blue_marble_2048.jpg")
OUT_LAND = os.path.join(TEX, "earth_land_2048.jpg")

JPEG_QUALITY = 90

# --- ночные огни: насколько гасить дымку ---
DEBLUE = 0.70         # сколько «лишней» синевы убрать из тёмных мест (0..1)
HAZE_FLOOR = 0.42     # во сколько раз гасится самая тёмная дымка
HAZE_LO = 18          # яркость, ниже которой гасим по полной
HAZE_HI = 95          # яркость, выше которой не трогаем (города)

# --- подложка суши: обесцвечивание и тон ---
SATURATION = 0.22     # сколько цвета оставить: 0 — серое, 1 — как у NASA
GAMMA = 1.15          # >1 — темнее, сильнее всего в полутонах
GAIN = 1.00           # общая яркость после гаммы
KNEE = 0.30           # с какой яркости начинается сжатие светов
KNEE_SLOPE = 0.34     # насколько поджимаются света (снег, льды, пустыни)


def save(img, path):
    img.save(path, quality=JPEG_QUALITY, optimize=True, progressive=True)
    print("Готово: %s (%.0f КБ)"
          % (os.path.relpath(path, ROOT), os.path.getsize(path) / 1024.0))


def haze_lut():
    """Яркость пикселя -> во сколько раз его пригасить (0..255 = 0..1)."""
    span = float(HAZE_HI - HAZE_LO)
    lut = []
    for i in range(256):
        t = 0.0 if i <= HAZE_LO else min(1.0, (i - HAZE_LO) / span)
        lut.append(int(round((HAZE_FLOOR + (1.0 - HAZE_FLOOR) * t) * 255)))
    return lut


def make_night():
    img = Image.open(SRC_NIGHT).convert("RGB")
    r, g, b = img.split()

    # 1. лишняя синева: у огней её нет, у ночной дымки она вся
    cold = ImageChops.subtract(b, ImageChops.lighter(r, g))
    b = ImageChops.subtract(b, cold.point(lambda v: int(v * DEBLUE)))
    img = Image.merge("RGB", (r, g, b))

    # 2. гасим дымку, города оставляем
    k = img.convert("L").point(haze_lut())
    img = Image.merge("RGB", tuple(ImageChops.multiply(c, k) for c in img.split()))
    save(img, OUT_NIGHT)


def land_lut():
    lut = []
    for i in range(256):
        v = (i / 255.0) ** GAMMA * GAIN
        if v > KNEE:
            v = KNEE + (v - KNEE) * KNEE_SLOPE
        lut.append(int(round(max(0.0, min(1.0, v)) * 255)))
    return lut


def make_land():
    img = Image.open(SRC_LAND).convert("RGB")
    grey = img.convert("L").convert("RGB")
    img = Image.blend(grey, img, SATURATION)      # обесцвечивание
    img = img.point(land_lut() * 3)               # гамма, яркость, сжатие светов
    save(img, OUT_LAND)


def main():
    for src in (SRC_NIGHT, SRC_LAND):
        if not os.path.exists(src):
            raise SystemExit("нет файла %s" % os.path.relpath(src, ROOT))
    make_night()
    make_land()


if __name__ == "__main__":
    main()
