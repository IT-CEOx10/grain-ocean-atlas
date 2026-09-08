# -*- coding: utf-8 -*-
"""Фактура фона зелёной темы: assets/textures/bg_green.jpg.

Заказчик прислал референс, где фон не плоский градиент, а тёмно-зелёная
фактура — что-то между мрамором, мхом и сухой краской: неровные пятна,
прожилки, мелкое зерно. Файла от заказчика нет, поэтому фактура рисуется
здесь, из шума.

Картинка бесшовная: её можно повторять плиткой, швов не видно. Это важно,
потому что в CSS она лежит фоном всей страницы и в широком окне повторяется.

Запуск:

    python3 tools/make_background.py

Нужен только PIL (Pillow), как и в make_earth_textures.py. Numpy не нужен.
Считает меньше секунды.

Из чего собирается картинка:

  1. Пятна    — сумма нескольких октав шума (крупные пятна плюс мелочь).
  2. Прожилки — «мрамор»: пила по диагонали, сдвинутая шумом (это и есть
                домен-варп), затем синус — получаются извилистые жилы.
  3. Зерно    — мелкий шум поверх всего, чтобы фон не выглядел пластиковым.
  4. Цвет     — яркость раскрашивается по палитре темы: от #0A1A18 через
                #10302A к #16423A, редкие светлые пятна #1C5548.

Все числа, которые стоит трогать, собраны в блоке НАСТРОЙКИ ниже.
"""
from __future__ import print_function

import math
import os
import random

from PIL import Image, ImageChops, ImageFilter

# --------------------------------- НАСТРОЙКИ ---------------------------------

SIZE = 1536            # сторона картинки, px. Должна делиться на все LATTICE
SEED = 20260908        # зерно генератора: с одним зерном получается один файл

# Октавы пятен: размер решётки шума и вес. Решётка мельче — деталь мельче.
SPOTS = [(6, 1.00), (12, 0.50), (24, 0.26), (48, 0.16), (96, 0.09), (192, 0.05)]

# Прожилки
VEIN_KX, VEIN_KY = 3, 4    # сколько полос по горизонтали и вертикали (целые!)
VEIN_WARP = 0.95           # сила домен-варпа: 0 — ровные полосы, 1 — каша
VEIN_LATTICE = [(6, 1.00), (12, 0.70), (24, 0.40), (48, 0.22), (96, 0.12)]  # шум для варпа
VEIN_SHARP = 8.0           # чем больше, тем тоньше жилы
VEIN_MIX = 0.19            # сколько жил подмешать к пятнам

GRAIN_MIX = 0.09           # сколько зерна подмешать
GRAIN_BLUR = 0.5           # лёгкое размытие зерна, чтобы не рябило

# Тоновая кривая: какой кусок шума растянуть на палитру.
# Чем выше TONE_LO и уже TONE_SPAN, тем контрастнее фон.
TONE_LO = 0.22
TONE_SPAN = 0.62
TONE_GAMMA = 1.25          # >1 — светлые пятна становятся реже

# Палитра: (доля яркости, цвет)
PALETTE = [
    (0.00, (0x0A, 0x1A, 0x18)),
    (0.45, (0x10, 0x30, 0x2A)),
    (0.80, (0x16, 0x42, 0x3A)),
    (1.00, (0x1C, 0x55, 0x48)),
]

QUALITY = 88               # качество JPEG; вес файла держим до 300 КБ
MAX_KB = 300

OUT = os.path.join("assets", "textures", "bg_green.jpg")

# ------------------------------------------------------------------------------

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def noise(size, lattice, rnd, pad=3):
    """Бесшовный шум: случайная решётка lattice×lattice, растянутая до size.

    Чтобы картинка стыковалась сама с собой, решётка сначала выкладывается
    плиткой 3×3, растягивается целиком, и из середины вырезается ровно один
    период. Тогда интерполяция на краю видит соседнюю плитку, а не пустоту.
    """
    if size % lattice:
        raise ValueError("сторона %d не делится на решётку %d" % (size, lattice))
    if lattice < 2 * pad:
        raise ValueError("решётка %d мельче запаса %d" % (lattice, pad))
    cell = Image.frombytes("L", (lattice, lattice), rnd.randbytes(lattice * lattice))
    wide = Image.new("L", (lattice + 2 * pad, lattice + 2 * pad))
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            wide.paste(cell, (pad + dx * lattice, pad + dy * lattice))
    k = size // lattice
    big = wide.resize(((lattice + 2 * pad) * k,) * 2, Image.BICUBIC)
    return big.crop((pad * k, pad * k, pad * k + size, pad * k + size))


def fbm(size, octaves, rnd):
    """Сумма октав шума с весами: крупные пятна плюс мелочь."""
    acc = None
    total = 0.0
    for lattice, weight in octaves:
        layer = noise(size, lattice, rnd)
        if acc is None:
            acc = layer
        else:
            acc = Image.blend(acc, layer, weight / (total + weight))
        total += weight
    return acc


def sawtooth(size, kx, ky):
    """Пила: значение растёт по диагонали и заворачивается через 255.

    Целые kx и ky дают ровно kx периодов по ширине и ky по высоте, поэтому
    картинка остаётся бесшовной, а после синуса ещё и без разрывов.
    """
    xs = [kx * 256.0 * x / size for x in range(size)]
    rows = []
    for y in range(size):
        off = ky * 256.0 * y / size
        rows.append(bytes(int(v + off) % 256 for v in xs))
    return Image.frombytes("L", (size, size), b"".join(rows))


def veins(size, rnd):
    """Мраморные прожилки: пилу сдвигает шум, затем синус даёт полосы."""
    warp = fbm(size, VEIN_LATTICE, rnd)
    shift = warp.point(lambda v: int(v * VEIN_WARP))
    phase = ImageChops.add_modulo(sawtooth(size, VEIN_KX, VEIN_KY), shift)
    lut = [int(255 * (0.5 - 0.5 * math.cos(2 * math.pi * v / 256.0)) ** VEIN_SHARP)
           for v in range(256)]
    return phase.point(lut)


def colorize(gray):
    """Яркость → цвет по палитре, по одной таблице на канал (быстро)."""
    luts = ([], [], [])
    for v in range(256):
        t = (v / 255.0 - TONE_LO) / TONE_SPAN
        t = min(max(t, 0.0), 1.0) ** TONE_GAMMA
        for i in range(len(PALETTE) - 1):
            p0, c0 = PALETTE[i]
            p1, c1 = PALETTE[i + 1]
            if t <= p1 or i == len(PALETTE) - 2:
                f = 0.0 if p1 == p0 else (t - p0) / (p1 - p0)
                f = min(max(f, 0.0), 1.0)
                for ch in range(3):
                    luts[ch].append(int(round(c0[ch] + (c1[ch] - c0[ch]) * f)))
                break
    return Image.merge("RGB", tuple(gray.point(luts[ch]) for ch in range(3)))


def main():
    rnd = random.Random(SEED)
    print("Рисую фактуру %d×%d…" % (SIZE, SIZE))

    gray = fbm(SIZE, SPOTS, rnd)
    print("  пятна готовы")

    gray = Image.blend(gray, veins(SIZE, rnd), VEIN_MIX)
    print("  прожилки готовы")

    grain = Image.frombytes("L", (SIZE, SIZE), rnd.randbytes(SIZE * SIZE))
    if GRAIN_BLUR:
        grain = grain.filter(ImageFilter.GaussianBlur(GRAIN_BLUR))
    gray = Image.blend(gray, grain, GRAIN_MIX)
    print("  зерно готово")

    img = colorize(gray)

    path = os.path.join(ROOT, OUT)
    folder = os.path.dirname(path)
    if not os.path.exists(folder):
        os.makedirs(folder)
    quality = QUALITY
    while True:
        img.save(path, "JPEG", quality=quality, optimize=True, subsampling=0)
        kb = os.path.getsize(path) / 1024.0
        if kb <= MAX_KB or quality <= 60:
            break
        quality -= 4
    print("Готово: %s (%.0f КБ, качество %d)" % (OUT, kb, quality))


if __name__ == "__main__":
    main()
