# -*- coding: utf-8 -*-
"""Сборка dist/index.html — одного самодостаточного файла.

Внутрь складываются CSS, все скрипты (включая vendor) и все данные
(config.json, data/export.json, data/geo/countries-110m.json) как блоки
<script type="application/json">. Ни одного внешнего запроса — файл
открывается двойным щелчком по file:// и годится для публикации как есть.

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


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


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

    # 3. стили
    def repl_css(m):
        path = os.path.join(ROOT, m.group(1))
        if not os.path.exists(path):
            die("нет стиля %s" % m.group(1))
        return "<style>\n" + guard(read(path), m.group(1)) + "\n</style>"

    html = re.sub(r'<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>', repl_css, html)

    # 4. скрипты
    scripts = re.findall(r'<script src="([^"]+)"></script>', html)
    if not scripts:
        die("в index.html не найдено ни одного <script src=...>")
    inlined = []
    for rel in scripts:
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            die("нет скрипта %s" % rel)
        inlined.append("<!-- %s -->\n<script>\n%s\n</script>" % (rel, guard(read(path), rel)))

    first = '<script src="%s"></script>' % scripts[0]
    html = html.replace(first, data_html + "\n" + inlined[0], 1)
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

    print("Собрано: %s (%.1f МБ)" % (os.path.relpath(out, ROOT), os.path.getsize(out) / 1048576.0))
    print("Файл открывается двойным щелчком, сервер не нужен.")


if __name__ == "__main__":
    main()
