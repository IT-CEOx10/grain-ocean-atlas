#!/usr/bin/env python3
"""Кладёт готовые страницы подпроекта в ../dist/3d-dark, откуда их публикует GitHub Pages.

  index.html        — тёмный макет (docs/mockup/preview.html, обёрнутый в html/head/body)
  proto/index.html  — рабочий прототип одним файлом, синяя тема (navy)
  ../green/index.html  — тот же прототип в зелёной теме (адрес сайта /green/)
  ../path/index.html   — экран «Центр управления производства зерна»,
                         первый экран блока 3 (адрес сайта /path/)
  ../story/index.html  — сквозная презентация «Путь зерна»: все экраны
                         разделов 01–08 в одном файле (адрес сайта /story/)
  ../monitoring/index.html — раздел «Мониторинг зерна РФ»: карта субъектов
                         и карточка региона (адрес сайта /monitoring/)

Обе темы лежат в каждом файле экрана глобуса, отличается только стартовая:
любую страницу можно переключить параметром адреса ?theme=navy / ?theme=green.
Экран блока 3 сделан только в зелёной теме.
"""
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]      # 3d-dark/
OUT = ROOT.parent / "dist" / "3d-dark"
GREEN_OUT = ROOT.parent / "dist" / "green"
PATH_OUT = ROOT.parent / "dist" / "path"
STORY_OUT = ROOT.parent / "dist" / "story"
MON_OUT = ROOT.parent / "dist" / "monitoring"
BUILD = ROOT / "tools" / "build_dist.py"

# синяя сборка кладётся в dist/index.html — это обычный результат build_dist.py,
# зелёная собирается отдельным файлом рядом и в репозиторий не попадает
proto_src = ROOT / "dist" / "index.html"
green_src = ROOT / "dist" / "index-green.html"
path_src = ROOT / "dist" / "path.html"
story_src = ROOT / "dist" / "story.html"
mon_src = ROOT / "dist" / "monitoring.html"

subprocess.run([sys.executable, str(BUILD)], check=True)
subprocess.run([sys.executable, str(BUILD), "--theme", "green",
                "--out", str(green_src)], check=True)
subprocess.run([sys.executable, str(BUILD), "--entry", "path.html",
                "--out", str(path_src)], check=True)
subprocess.run([sys.executable, str(BUILD), "--entry", "story.html",
                "--out", str(story_src)], check=True)
subprocess.run([sys.executable, str(BUILD), "--entry", "monitoring.html",
                "--out", str(mon_src)], check=True)

OUT.mkdir(parents=True, exist_ok=True)
(OUT / "proto").mkdir(exist_ok=True)
GREEN_OUT.mkdir(parents=True, exist_ok=True)
PATH_OUT.mkdir(parents=True, exist_ok=True)
STORY_OUT.mkdir(parents=True, exist_ok=True)
MON_OUT.mkdir(parents=True, exist_ok=True)

mock = (ROOT / "docs" / "mockup" / "preview.html").read_text(encoding="utf-8")
wrapped = ('<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
           '</head>\n<body style="margin:0;background:#05070C">\n' + mock + '\n</body>\n</html>\n')
(OUT / "index.html").write_text(wrapped, encoding="utf-8")

proto = proto_src.read_bytes()
(OUT / "proto" / "index.html").write_bytes(proto)
green = green_src.read_bytes()
(GREEN_OUT / "index.html").write_bytes(green)
grain = path_src.read_bytes()
(PATH_OUT / "index.html").write_bytes(grain)
story = story_src.read_bytes()
(STORY_OUT / "index.html").write_bytes(story)
monitoring = mon_src.read_bytes()
(MON_OUT / "index.html").write_bytes(monitoring)

print("ok:", OUT / "index.html", len(wrapped) // 1024, "KB;",
      OUT / "proto/index.html", len(proto) // 1024, "KB;",
      GREEN_OUT / "index.html", len(green) // 1024, "KB;",
      PATH_OUT / "index.html", len(grain) // 1024, "KB;",
      STORY_OUT / "index.html", len(story) // 1024, "KB;",
      MON_OUT / "index.html", len(monitoring) // 1024, "KB")
