#!/usr/bin/env python3
"""Мини-клиент локального MCP-сервера Figma Desktop. figma.py tools | call <tool> '<json>' [out]"""
import sys, json, base64, urllib.request
URL = "http://127.0.0.1:3845/mcp"
H = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
def post(body, sid=None):
    h = dict(H)
    if sid: h["mcp-session-id"] = sid
    r = urllib.request.urlopen(urllib.request.Request(URL, json.dumps(body).encode(), h), timeout=180)
    sid = r.headers.get("mcp-session-id") or sid
    raw = r.read().decode()
    out = None
    buf = []
    for line in raw.split("\n"):
        line = line.rstrip("\r")
        if line.startswith("data:"):
            buf.append(line[5:].lstrip(" "))
        elif line == "" and buf:
            try: out = json.loads("\n".join(buf))
            except Exception:
                try: out = json.loads("".join(buf))
                except Exception: pass
            buf = []
    if buf:
        try: out = json.loads("".join(buf))
        except Exception: pass
    if out is None and raw.strip().startswith("{"): out = json.loads(raw)
    return out, sid
_, sid = post({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"claude-code","version":"1.0"}}})
try: post({"jsonrpc":"2.0","method":"notifications/initialized"}, sid)
except Exception: pass
if sys.argv[1] == "tools":
    res, _ = post({"jsonrpc":"2.0","id":2,"method":"tools/list"}, sid)
    for t in res["result"]["tools"]:
        print(t["name"], "—", json.dumps(t["inputSchema"].get("properties", {}), ensure_ascii=False)[:300])
else:
    res, _ = post({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":sys.argv[2],"arguments":json.loads(sys.argv[3])}}, sid)
    out = sys.argv[4] if len(sys.argv) > 4 else None
    if "error" in res: print("ERROR", res["error"]); sys.exit(1)
    for i, c in enumerate(res["result"].get("content", [])):
        if c["type"] == "text":
            if out and not out.endswith(".png"):
                p = out if i == 0 else out + ".%d" % i
                open(p, "w").write(c["text"]); print("text ->", p, len(c["text"]))
            else: print(c["text"][:6000])
        elif c["type"] == "image":
            if out and not out.endswith(".png"): continue
            p = out or "img%d.png" % i
            open(p, "wb").write(base64.b64decode(c["data"])); print("image ->", p)
