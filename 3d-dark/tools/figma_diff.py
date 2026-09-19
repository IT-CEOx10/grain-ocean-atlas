import sys, glob, os
from PIL import Image, ImageChops, ImageFilter, ImageDraw
REF=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","docs","mockup","figma-1920")+"/"  # кадры 1920x1080 из экспорта Figma
S=sys.argv[1] if len(sys.argv)>1 else os.path.dirname(os.path.abspath(__file__))
rows=[]
for f in sorted(glob.glob(S+"/full/*.png")):
    n=os.path.basename(f)[:-4]; rp=REF+n+".jpg"
    if not os.path.exists(rp): continue
    ref=Image.open(rp).convert("RGB"); W,H=ref.size
    our=Image.open(f).convert("RGB").resize((W,H),Image.LANCZOS)
    d=ImageChops.difference(our,ref).convert("L").filter(ImageFilter.BoxBlur(3))
    C=16; gw,gh=W//C,H//C
    small=d.resize((gw,gh),Image.BOX); px=small.load()
    hot=[[px[x,y]>22 for x in range(gw)] for y in range(gh)]
    seen=[[False]*gw for _ in range(gh)]; boxes=[]
    for y in range(gh):
        for x in range(gw):
            if hot[y][x] and not seen[y][x]:
                st=[(x,y)]; seen[y][x]=True; x0=x1=x; y0=y1=y; cnt=0
                while st:
                    cx,cy=st.pop(); cnt+=1; x0=min(x0,cx);x1=max(x1,cx);y0=min(y0,cy);y1=max(y1,cy)
                    for dx in(-1,0,1):
                        for dy in(-1,0,1):
                            nx,ny=cx+dx,cy+dy
                            if 0<=nx<gw and 0<=ny<gh and hot[ny][nx] and not seen[ny][nx]: seen[ny][nx]=True; st.append((nx,ny))
                if cnt>=3: boxes.append((cnt,x0*C,y0*C,(x1+1)*C,(y1+1)*C))
    boxes.sort(reverse=True)
    pct=100.0*sum(b[0] for b in boxes)/(gw*gh)
    rows.append((pct,n,boxes[:6]))
    # монтаж: слева Figma, справа демка, рамки на обоих
    m=Image.new("RGB",(W*2+8,H),(255,0,0))
    a=ref.copy(); b=our.copy()
    for im in (a,b):
        dr=ImageDraw.Draw(im)
        for c,x0,y0,x1,y1 in boxes[:8]: dr.rectangle((x0,y0,x1,y1),outline=(255,40,40),width=2)
    m.paste(a,(0,0)); m.paste(b,(W+8,0)); m.save(S+"/diff/"+n+".jpg",quality=82)
for pct,n,boxes in sorted(rows,reverse=True):
    k=1920.0/1024
    print("%5.1f%%  %-16s %s"%(pct,n," ".join("[%d,%d %dx%d]"%(b[1]*k,b[2]*k,(b[3]-b[1])*k,(b[4]-b[2])*k) for b in boxes[:4])))
