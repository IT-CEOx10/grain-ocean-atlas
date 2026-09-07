# -*- coding: utf-8 -*-
"""Готовит текстуры глобуса из снимков NASA.

Оригиналы NASA лежат рядом и не меняются:

  assets/textures/nasa_black_marble_4096.jpg  — Black Marble 2016, ночные огни
  assets/textures/nasa_blue_marble_2048.jpg   — Blue Marble Next Generation, день

Скрипт делает из них две рабочие текстуры:

  assets/textures/earth_night_4096.jpg  — огни городов для emissive:
      синеватая ночная дымка гасится плавной кривой (не по порогу), цвет огней
      уводится к тёплому белому, поверх резкой картинки подмешиваются две
      размытые копии — от них у огней появляется ореол и агломерации
      сливаются в светящиеся области; света прижимаются мягкой кривой,
      поэтому в рендере они не уходят в жёлтый клиппинг;
  assets/textures/earth_land_2048.jpg   — подложка суши для diffuse:
      дневной снимок разделяется по маске «вода/суша». Суша становится
      светлой холодно-серой с сохранённым рельефом, океан — тёмно-синим.
      Общую яркость и оттенок задаёт `colors.land` из config.json.

Запуск:  python3 tools/make_earth_textures.py
"""
from __future__ import print_function

import math
import os

from PIL import Image, ImageChops, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX = os.path.join(ROOT, "assets", "textures")

SRC_NIGHT = os.path.join(TEX, "nasa_black_marble_4096.jpg")
OUT_NIGHT = os.path.join(TEX, "earth_night_4096.jpg")
SRC_LAND = os.path.join(TEX, "nasa_blue_marble_2048.jpg")
OUT_LAND = os.path.join(TEX, "earth_land_2048.jpg")

JPEG_QUALITY = 92

# --- ночные огни ---------------------------------------------------------
DEBLUE = 0.90         # сколько холодного оттенка снять с ночной дымки (0..1)
HAZE_FLOOR = 0.03     # что остаётся от дымки в самых тёмных местах
HAZE_LO = 12          # яркость: ниже — это дымка
HAZE_HI = 64          # яркость: выше — это уже город, не трогаем
LIGHT_SAT = 0.45      # сколько исходной насыщенности оставить огням
SHARP_W = 0.46        # вес резкой картинки в сумме
GLOW_NEAR_R = 5.0     # радиус ближнего ореола, px по 4096
GLOW_NEAR_W = 0.32
GLOW_WIDE_R = 17.0    # радиус дальнего свечения, px по 4096
GLOW_WIDE_W = 0.22
NIGHT_GAIN = 2.9      # общее усиление перед сжатием светов
NIGHT_CEIL = 0.93     # потолок мягкой кривой: пики не доходят до 255

# --- подложка суши -------------------------------------------------------
SEA_LO = 6            # (синий - красный): ниже — точно суша
SEA_HI = 26           # выше — точно вода
LAND_SAT = 0.16       # сколько цвета оставить суше: 0 — серая
LAND_GAMMA = 0.85     # <1 — светлее, сильнее всего в полутонах
LAND_KNEE = 0.45      # с какой яркости поджимаются света (снег, пустыни)
LAND_KNEE_SLOPE = 0.18
LAND_FLOOR = 0.10     # самая тёмная суша не проваливается в чёрное
LAND_CEIL = 0.62
LAND_TINT = (0.64, 0.74, 1.23)     # лёгкий холодный уклон суши
OCEAN_FLOOR = 0.210   # глубокий океан
OCEAN_SPAN = 0.080    # насколько мелководье светлее глубин
OCEAN_TINT = (0.62, 0.80, 1.18)    # тёмно-синий


def save(img, path):
    img.save(path, quality=JPEG_QUALITY, optimize=True, progressive=True)
    print("Готово: %s (%.0f КБ)"
          % (os.path.relpath(path, ROOT), os.path.getsize(path) / 1024.0))


def smoothstep(x, lo, hi):
    if hi <= lo:
        return 1.0 if x >= hi else 0.0
    t = min(1.0, max(0.0, (x - lo) / float(hi - lo)))
    return t * t * (3.0 - 2.0 * t)


def clamp8(v):
    return int(round(max(0.0, min(255.0, v))))


def scale_channel(ch, w):
    """Умножает канал на вес < 1 (для сложения без переполнения)."""
    return ch.point([clamp8(i * w) for i in range(256)])


# --------------------------- ночные огни ---------------------------------

def haze_lut():
    """Яркость -> во сколько раз пригасить: плавно, без порога."""
    return [clamp8(255 * (HAZE_FLOOR + (1.0 - HAZE_FLOOR)
                          * smoothstep(i, HAZE_LO, HAZE_HI)))
            for i in range(256)]


def night_lut():
    """Усиление + мягкое сжатие светов (экспоненциальная кривая)."""
    lut = []
    for i in range(256):
        x = (i / 255.0) * NIGHT_GAIN
        lut.append(clamp8(255 * NIGHT_CEIL * (1.0 - math.exp(-x / NIGHT_CEIL))))
    return lut


def make_night():
    img = Image.open(SRC_NIGHT).convert("RGB")
    r, g, b = img.split()

    # 1. холодная дымка: у огней синевы нет, у дымки она вся
    cold = ImageChops.subtract(b, ImageChops.lighter(r, g))
    b = ImageChops.subtract(b, scale_channel(cold, DEBLUE))
    img = Image.merge("RGB", (r, g, b))

    # 2. гасим дымку плавной кривой, города оставляем как есть
    k = img.convert("L").point(haze_lut())
    img = Image.merge("RGB", tuple(ImageChops.multiply(c, k) for c in img.split()))

    # 3. цвет огней — к тёплому белому
    grey = img.convert("L").convert("RGB")
    img = Image.blend(grey, img, LIGHT_SAT)

    # 4. ореол: резкая картинка + две размытые копии
    near = img.filter(ImageFilter.GaussianBlur(GLOW_NEAR_R))
    wide = img.filter(ImageFilter.GaussianBlur(GLOW_WIDE_R))
    parts = []
    for i in range(3):
        s = scale_channel(img.split()[i], SHARP_W)
        s = ImageChops.add(s, scale_channel(near.split()[i], GLOW_NEAR_W))
        s = ImageChops.add(s, scale_channel(wide.split()[i], GLOW_WIDE_W))
        parts.append(s)
    img = Image.merge("RGB", parts)

    # 5. усиление и мягкое сжатие пиков вместо клиппинга
    img = img.point(night_lut() * 3)
    save(img, OUT_NIGHT)


# --------------------------- подложка суши -------------------------------

def sea_mask_lut():
    return [clamp8(255 * smoothstep(i, SEA_LO, SEA_HI)) for i in range(256)]


def land_lut():
    lut = []
    for i in range(256):
        v = (i / 255.0) ** LAND_GAMMA
        if v > LAND_KNEE:
            v = LAND_KNEE + (v - LAND_KNEE) * LAND_KNEE_SLOPE
        v = LAND_FLOOR + (LAND_CEIL - LAND_FLOOR) * min(1.0, v)
        lut.append(clamp8(255 * v))
    return lut


def ocean_lut():
    return [clamp8(255 * (OCEAN_FLOOR + OCEAN_SPAN * (i / 255.0) ** 1.4))
            for i in range(256)]


def tint(img, factors):
    return Image.merge("RGB", [scale_channel(ch, f)
                               for ch, f in zip(img.split(), factors)])


def make_land():
    img = Image.open(SRC_LAND).convert("RGB")
    r, g, b = img.split()
    grey = img.convert("L")

    # вода отличается от суши тем, что синего в ней заметно больше красного
    mask = ImageChops.subtract(b, r).point(sea_mask_lut())
    mask = mask.filter(ImageFilter.GaussianBlur(0.7))

    land = Image.blend(grey.convert("RGB"), img, LAND_SAT)
    land = tint(land.point(land_lut() * 3), LAND_TINT)

    ocean = tint(grey.point(ocean_lut()).convert("RGB"), OCEAN_TINT)

    save(Image.composite(ocean, land, mask), OUT_LAND)


def main():
    for src in (SRC_NIGHT, SRC_LAND):
        if not os.path.exists(src):
            raise SystemExit("нет файла %s" % os.path.relpath(src, ROOT))
    make_night()
    make_land()


if __name__ == "__main__":
    main()
