#!/bin/bash
# Снимки экранов презентации для сверки с макетом: tools/shots.sh <папка> [имя=запрос ...]
# Chrome запускается СТРОГО по одному и принудительно завершается после каждого снимка:
# зависшие скрытые копии мешают открыть обычный Chrome на этом же компьютере.
OUT="$1"; shift; mkdir -p "$OUT"
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for pair in "$@"; do
  n="${pair%%=*}"; q="${pair#*=}"; prof="$OUT/.ch-$n"; rm -rf "$prof" "$OUT/$n.png"
  "$CH" --headless=new --disable-gpu --hide-scrollbars --no-first-run --user-data-dir="$prof" \
    --window-size=1920,1080 --force-device-scale-factor=1 --virtual-time-budget=9000 \
    --screenshot="$OUT/$n.png" "http://localhost:8765/story.html?$q&idle=0&cb=$RANDOM" >/dev/null 2>&1 &
  p=$!
  for i in $(seq 1 22); do sleep 1; [ -s "$OUT/$n.png" ] && sleep 1 && break; kill -0 $p 2>/dev/null || break; done
  kill -9 $p 2>/dev/null; pkill -9 -f "user-data-dir=$prof" 2>/dev/null; rm -rf "$prof"
done
