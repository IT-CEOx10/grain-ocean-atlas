#!/usr/bin/env python3
"""Кладёт готовые страницы подпроекта в ../dist/3d-dark, откуда их публикует GitHub Pages.

  index.html        — тёмный макет (docs/mockup/preview.html, обёрнутый в html/head/body)
  proto/index.html  — рабочий прототип одним файлом (результат build_dist.py)
"""
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]      # 3d-dark/
OUT = ROOT.parent / "dist" / "3d-dark"

subprocess.run([sys.executable, str(ROOT / "tools" / "build_dist.py")], check=True)

OUT.mkdir(parents=True, exist_ok=True)
(OUT / "proto").mkdir(exist_ok=True)

mock = (ROOT / "docs" / "mockup" / "preview.html").read_text(encoding="utf-8")
wrapped = ('<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
           '</head>\n<body style="margin:0;background:#05070C">\n' + mock + '\n</body>\n</html>\n')
(OUT / "index.html").write_text(wrapped, encoding="utf-8")

proto = (ROOT / "dist" / "index.html").read_bytes()
(OUT / "proto" / "index.html").write_bytes(proto)
print("ok:", OUT / "index.html", len(wrapped) // 1024, "KB;", OUT / "proto/index.html", len(proto) // 1024, "KB")
