# -*- coding: utf-8 -*-
"""Готовит текстуры глобуса из снимков NASA.

Оригиналы NASA лежат рядом и не меняются:

  assets/textures/nasa_black_marble_8192.jpg  — Black Marble 2016, ночные огни
  assets/textures/nasa_black_marble_4096.jpg  — то же, вдвое меньше
  assets/textures/nasa_blue_marble_4096.jpg   — Blue Marble Next Generation, день
  assets/textures/nasa_blue_marble_2048.jpg   — то же, вдвое меньше

Скрипт делает из них рабочие текстуры — по две на каждый слой: основную
и уменьшенную запасную (её берёт `src/globe.js`, если видеокарта не тянет
текстуру нужного размера, см. README, раздел «Текстуры Земли»):

  assets/textures/earth_night_8192.jpg  — огни городов для emissive:
  assets/textures/earth_night_4096.jpg      синеватая ночная дымка гасится
      плавной кривой (не по порогу), цвет огней уводится к тёплому белому,
      поверх резкой картинки подмешиваются две размытые копии — от них
      у огней появляется ореол и агломерации сливаются в светящиеся области;
      света прижимаются мягкой кривой, поэтому в рендере они не уходят
      в жёлтый клиппинг;
  assets/textures/earth_land_4096.jpg   — подложка суши для diffuse:
  assets/textures/earth_land_2048.jpg       дневной снимок разделяется по маске
      «вода/суша». Суша становится светлой холодно-серой с сохранённым
      рельефом, океан — тёмно-синим. Общую яркость и оттенок задаёт
      `colors.land` из config.json;
  assets/textures/earth_land_4096_green.jpg — то же для зелёной темы:
  assets/textures/earth_land_2048_green.jpg     тёмно-зелёная суша с рельефом
      и бирюзовый океан. Обработка та же, различаются только множители
      по каналам — см. словарь LAND_THEMES ниже.

Радиусы размытия заданы в пикселях для ширины 4096 и пересчитываются
пропорционально размеру снимка, поэтому текстуры разного разрешения
выглядят на общем плане одинаково.

Запуск:  python3 tools/make_earth_textures.py
"""
from __future__ import print_function

import math
import os

from PIL import Image, ImageChops, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX = os.path.join(ROOT, "assets", "textures")

REF_W = 4096.0        # ширина, для которой заданы радиусы размытия

# (исходник, результат, качество JPEG)
NIGHT_JOBS = [
    ("nasa_black_marble_8192.jpg", "earth_night_8192.jpg", 93),
    ("nasa_black_marble_4096.jpg", "earth_night_4096.jpg", 93),
]
# (исходник, размер в имени результата, качество JPEG)
LAND_JOBS = [
    ("nasa_blue_marble_4096.jpg", 4096, 90),
    ("nasa_blue_marble_2048.jpg", 2048, 92),
]

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
SEA_BLUR_R = 0.7      # сглаживание маски берега, px по 4096
LAND_SAT = 0.16       # сколько цвета оставить суше: 0 — серая
LAND_GAMMA = 0.85     # <1 — светлее, сильнее всего в полутонах
LAND_KNEE = 0.45      # с какой яркости поджимаются света (снег, пустыни)
LAND_KNEE_SLOPE = 0.18
LAND_FLOOR = 0.10     # самая тёмная суша не проваливается в чёрное
LAND_CEIL = 0.62
OCEAN_FLOOR = 0.210   # глубокий океан
OCEAN_SPAN = 0.080    # насколько мелководье светлее глубин

# Темы. Общая обработка одна, различаются только множители по каналам
# (и насыщенность суши). Имя результата — earth_land_<размер><суффикс>.jpg,
# то есть у navy суффикса нет и файлы остаются прежними.
LAND_THEMES = {
    "navy": {
        "suffix": "",
        "land_sat": LAND_SAT,
        "land_tint": (0.64, 0.74, 1.23),    # лёгкий холодный уклон суши
        "ocean_tint": (0.62, 0.80, 1.18),   # тёмно-синий океан
    },
    "green": {
        "suffix": "_green",
        "land_sat": 0.26,                   # больше исходного цвета: оливковые равнины
        "land_tint": (0.50, 1.00, 0.74),    # тёмно-зелёная суша, светлее по хребтам
        "land_floor": 0.16,                 # зелень темнее синевы, диапазон шире
        "land_ceil": 0.78,
        "ocean_tint": (0.26, 0.78, 0.75),   # тёмная бирюза
        "ocean_floor": 0.42,                # светлее синего: в рендере вода
        "ocean_span": 0.14,                 # иначе уходит в чёрное
    },
}


def save(img, name, quality):
    path = os.path.join(TEX, name)
    img.save(path, quality=quality, optimize=True, progressive=True)
    print("Готово: %s  %dx%d, %.0f КБ, качество %d"
          % (name, img.size[0], img.size[1],
             os.path.getsize(path) / 1024.0, quality))


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


def make_night(src_name, out_name, quality):
    img = Image.open(os.path.join(TEX, src_name)).convert("RGB")
    k = img.size[0] / REF_W          # радиусы размытия — пропорционально ширине
    r, g, b = img.split()

    # 1. холодная дымка: у огней синевы нет, у дымки она вся
    cold = ImageChops.subtract(b, ImageChops.lighter(r, g))
    b = ImageChops.subtract(b, scale_channel(cold, DEBLUE))
    img = Image.merge("RGB", (r, g, b))

    # 2. гасим дымку плавной кривой, города оставляем как есть
    mul = img.convert("L").point(haze_lut())
    img = Image.merge("RGB", tuple(ImageChops.multiply(c, mul) for c in img.split()))

    # 3. цвет огней — к тёплому белому
    grey = img.convert("L").convert("RGB")
    img = Image.blend(grey, img, LIGHT_SAT)

    # 4. ореол: резкая картинка + две размытые копии
    near = img.filter(ImageFilter.GaussianBlur(GLOW_NEAR_R * k))
    wide = img.filter(ImageFilter.GaussianBlur(GLOW_WIDE_R * k))
    parts = []
    for i in range(3):
        s = scale_channel(img.split()[i], SHARP_W)
        s = ImageChops.add(s, scale_channel(near.split()[i], GLOW_NEAR_W))
        s = ImageChops.add(s, scale_channel(wide.split()[i], GLOW_WIDE_W))
        parts.append(s)
    img = Image.merge("RGB", parts)

    # 5. усиление и мягкое сжатие пиков вместо клиппинга
    img = img.point(night_lut() * 3)
    save(img, out_name, quality)


# --------------------------- подложка суши -------------------------------

def sea_mask_lut():
    return [clamp8(255 * smoothstep(i, SEA_LO, SEA_HI)) for i in range(256)]


def land_lut(theme):
    floor = theme.get("land_floor", LAND_FLOOR)
    ceil = theme.get("land_ceil", LAND_CEIL)
    lut = []
    for i in range(256):
        v = (i / 255.0) ** LAND_GAMMA
        if v > LAND_KNEE:
            v = LAND_KNEE + (v - LAND_KNEE) * LAND_KNEE_SLOPE
        v = floor + (ceil - floor) * min(1.0, v)
        lut.append(clamp8(255 * v))
    return lut


def ocean_lut(theme):
    floor = theme.get("ocean_floor", OCEAN_FLOOR)
    span = theme.get("ocean_span", OCEAN_SPAN)
    return [clamp8(255 * (floor + span * (i / 255.0) ** 1.4))
            for i in range(256)]


def tint(img, factors):
    return Image.merge("RGB", [scale_channel(ch, f)
                               for ch, f in zip(img.split(), factors)])


def make_land(src_name, size, quality, theme):
    img = Image.open(os.path.join(TEX, src_name)).convert("RGB")
    k = img.size[0] / REF_W
    r, g, b = img.split()
    grey = img.convert("L")

    # вода отличается от суши тем, что синего в ней заметно больше красного
    mask = ImageChops.subtract(b, r).point(sea_mask_lut())
    mask = mask.filter(ImageFilter.GaussianBlur(SEA_BLUR_R * k))

    land = Image.blend(grey.convert("RGB"), img, theme["land_sat"])
    land = tint(land.point(land_lut(theme) * 3), theme["land_tint"])

    ocean = tint(grey.point(ocean_lut(theme)).convert("RGB"), theme["ocean_tint"])

    out_name = "earth_land_%d%s.jpg" % (size, theme["suffix"])
    save(Image.composite(ocean, land, mask), out_name, quality)


def main():
    Image.MAX_IMAGE_PIXELS = None
    srcs = [j[0] for j in NIGHT_JOBS] + [j[0] for j in LAND_JOBS]
    for src in srcs:
        if not os.path.exists(os.path.join(TEX, src)):
            raise SystemExit("нет файла assets/textures/%s" % src)
    for src, out, q in NIGHT_JOBS:
        make_night(src, out, q)
    for name, theme in sorted(LAND_THEMES.items()):
        print("Тема %s:" % name)
        for src, size, q in LAND_JOBS:
            make_land(src, size, q, theme)


if __name__ == "__main__":
    main()
