# -*- coding: utf-8 -*-
"""Сборка dist/index.html — одного самодостаточного файла.

Внутрь складываются CSS, все скрипты (включая vendor) и все данные
(config.json, data/export.json, data/geo/countries-110m.json) как блоки
<script type="application/json">. Файлы из assets/ (шрифты, текстуры глобуса,
видео) вшиваются как data:URI: шрифты — прямо в CSS, текстуры — в объект
window.INLINE_ASSETS, откуда их берёт U.asset() в src/util.js.
Ни одного внешнего запроса — файл открывается двойным щелчком по file://
и годится для публикации как есть.

Запуск:  python3 tools/build_dist.py
Перед этим — python3 tools/build_data.py, если менялся xlsx.
"""
from __future__ import print_function

import base64
import json
import mimetypes
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")

# какие данные во что превращаются
INLINE_JSON = [
    ("inline-config", "config.json"),
    ("inline-export", os.path.join("data", "export.json")),
    ("inline-topo", os.path.join("data", "geo", "countries-110m.json")),
]

MAX_VIDEO_MB = 60
MAX_DIST_MB = 6          # предупреждение, если файл разросся

mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/woff", ".woff")

# ссылки на файлы из assets/ ищутся в CSS и в скриптах
ASSET_RE = re.compile(r"assets/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|svg|woff2?|mp4|webm)")


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def data_uri(path):
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    with open(path, "rb") as f:
        return "data:%s;base64,%s" % (mime, base64.b64encode(f.read()).decode("ascii"))


def die(msg):
    print("ОШИБКА: " + msg)
    sys.exit(1)


def json_block(el_id, obj):
    """JSON внутри <script>: экранируем '</', чтобы не порвать тег."""
    txt = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return '<script type="application/json" id="%s">%s</script>' % (el_id, txt)


def guard(code, what):
    if "</script" in code.lower():
        die("в %s встречается '</script' — инлайн сломается, нужен другой файл." % what)
    return code


def main():
    html = read(os.path.join(ROOT, "index.html"))

    # 1. данные
    blocks = []
    cfg = None
    for el_id, rel in INLINE_JSON:
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            die("нет файла %s. Сначала запустите tools/build_data.py." % rel)
        obj = json.loads(read(path))
        if el_id == "inline-config":
            cfg = obj
        blocks.append((el_id, obj, rel))

    # 2. видео: если файл есть — вшиваем, если нет — сразу показываем заглушку
    video_rel = (cfg or {}).get("shipVideo") or ""
    video_path = os.path.join(ROOT, video_rel) if video_rel else ""
    if video_path and os.path.exists(video_path):
        size_mb = os.path.getsize(video_path) / (1024.0 * 1024.0)
        if size_mb > MAX_VIDEO_MB:
            die("видео %s весит %.1f МБ (лимит %d МБ). Сожмите файл." % (video_rel, size_mb, MAX_VIDEO_MB))
        mime = mimetypes.guess_type(video_path)[0] or "video/mp4"
        with open(video_path, "rb") as f:
            data = base64.b64encode(f.read()).decode("ascii")
        cfg["shipVideo"] = "data:%s;base64,%s" % (mime, data)
        print("Видео вшито: %s (%.1f МБ)" % (video_rel, size_mb))
    else:
        cfg["shipVideo"] = ""
        print("Видео не найдено (%s) — в dist будет заглушка." % (video_rel or "путь не задан"))

    data_html = "\n".join(json_block(el_id, obj) for el_id, obj, _ in blocks)

    # 3. стили: заодно вшиваем шрифты и картинки из url(...)
    fonts_kb = [0]

    def repl_css(m):
        rel_css = m.group(1)
        path = os.path.join(ROOT, rel_css)
        if not os.path.exists(path):
            die("нет стиля %s" % rel_css)
        css_dir = os.path.dirname(path)

        def repl_url(u):
            raw = u.group(1).strip().strip("'\"")
            if raw.startswith("data:") or raw.startswith("#"):
                return u.group(0)
            src = os.path.normpath(os.path.join(css_dir, raw))
            if not os.path.exists(src):
                die("в %s не найден файл %s" % (rel_css, raw))
            fonts_kb[0] += os.path.getsize(src)
            return "url(%s)" % data_uri(src)

        css = re.sub(r"url\(([^)]+)\)", repl_url, read(path))
        return "<style>\n" + guard(css, rel_css) + "\n</style>"

    html = re.sub(r'<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>', repl_css, html)
    if fonts_kb[0]:
        print("Файлы из CSS (шрифты и т. п.) вшиты: %.0f КБ" % (fonts_kb[0] / 1024.0))

    # 4. скрипты
    scripts = re.findall(r'<script src="([^"]+)"></script>', html)
    if not scripts:
        die("в index.html не найдено ни одного <script src=...>")
    inlined = []
    assets = {}
    for rel in scripts:
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            die("нет скрипта %s" % rel)
        code = guard(read(path), rel)
        for a in ASSET_RE.findall(code):
            assets.setdefault(a, None)
        inlined.append("<!-- %s -->\n<script>\n%s\n</script>" % (rel, code))

    # 4a. файлы из assets/, на которые ссылаются скрипты (текстуры глобуса)
    assets_bytes = 0
    for rel in list(assets):
        src = os.path.join(ROOT, rel)
        if not os.path.exists(src):
            die("нет файла %s, на который ссылается код" % rel)
        assets_bytes += os.path.getsize(src)
        assets[rel] = data_uri(src)
    if assets:
        print("Файлы из assets/ вшиты: %d шт., %.0f КБ"
              % (len(assets), assets_bytes / 1024.0))
    assets_html = ("<script>window.INLINE_ASSETS=%s;</script>"
                   % json.dumps(assets, ensure_ascii=False))

    first = '<script src="%s"></script>' % scripts[0]
    html = html.replace(first, data_html + "\n" + assets_html + "\n" + inlined[0], 1)
    for rel, code in zip(scripts[1:], inlined[1:]):
        html = html.replace('<script src="%s"></script>' % rel, code, 1)

    # 5. проверка: не осталось внешних ссылок
    leftovers = re.findall(r'(?:src|href)="((?!#|data:)[^"]+)"', html)
    if leftovers:
        die("в dist остались внешние ссылки: %s" % ", ".join(sorted(set(leftovers))))

    if not os.path.exists(DIST):
        os.makedirs(DIST)
    out = os.path.join(DIST, "index.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)

    size_mb = os.path.getsize(out) / 1048576.0
    print("Собрано: %s (%.1f МБ)" % (os.path.relpath(out, ROOT), size_mb))
    if size_mb > MAX_DIST_MB:
        print("ВНИМАНИЕ: файл больше %d МБ — проверьте, что вшито." % MAX_DIST_MB)
    print("Файл открывается двойным щелчком, сервер не нужен.")


if __name__ == "__main__":
    main()
