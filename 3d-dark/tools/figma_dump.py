#!/usr/bin/env python3
"""Выгружает кадры макета из открытой Figma Desktop в docs/mockup/concept-18-09/.

На каждый кадр два файла: <имя>.png (кадр 1920x1080) и <имя>.code.txt
(разметка с точными координатами, шрифтами, цветами и ссылками на слои).
Нужно: Figma Desktop запущена, файл макета открыт во вкладке, в настройках
включён локальный MCP-сервер. Запуск: python3 tools/figma_dump.py [префикс ...]
"""
import subprocess, sys, os, json
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs", "mockup", "concept-18-09")
os.makedirs(OUT, exist_ok=True)
F = [("01-intro","465:2738"),("02-start","465:2361"),("03-hub","465:2404"),("03b-regions","465:2500"),
("05-soil-1","448:1585"),("06-soil-2","448:1659"),("07-seed-1","448:1758"),("08-seed-2","448:1803"),
("09-seed-3-a","448:1820"),("09-seed-3-b","448:1839"),("09-seed-3-c","448:1858"),
("11-quality-1","448:1885"),("12-quality-2","448:1910"),
("13-store-1","465:1782"),("13-store-2","465:1818"),("13-store-3","465:1854"),("13-store-4","465:1890"),("13-store-5","465:1922"),
("13-store-6","465:1957"),("13-store-7","465:1996"),("13-store-8","465:2036"),("13-store-9","465:2075"),
("15-route-pick","448:2251"),("16-food-a","448:2286"),("16-food-b","448:2303"),("16-food-c","448:2329"),("16-food-d","448:2354"),
("17-feed-1","448:2380"),("17-feed-2","448:2401"),("18-fuel","465:2294"),("19-product","448:2564"),
("20-export-1","465:1643"),("21-export-2","465:1666"),("22-final-a","465:1689"),("22-final-b","465:1702"),
("23-monitoring","474:681"),("24-region","474:652"),
("25-globe-intro","475:1965"),("25-globe-map-2015","475:2042"),("25-globe-map-2025","475:1781"),("25-globe-country-a","477:647"),("25-globe-country-b","477:789")]
only = sys.argv[1:] 
for name, nid in F:
    if only and not any(name.startswith(o) for o in only): continue
    for tool, ext, args in (("get_screenshot", "png", {"nodeId": nid}), ("get_design_context", "code.txt", {"nodeId": nid, "clientLanguages": "html,css,javascript", "clientFrameworks": "unknown", "forceCode": True})):
        p = "%s/%s.%s" % (OUT, name, ext)
        if os.path.exists(p) and os.path.getsize(p) > 500: continue
        r = subprocess.run(["python3", os.path.join(os.path.dirname(os.path.abspath(__file__)), "figma_mcp.py"), "call", tool, json.dumps(args), p], capture_output=True, text=True)
        print(name, tool, (r.stdout.strip().splitlines() or [r.stderr[-200:]])[-1][:160], flush=True)
