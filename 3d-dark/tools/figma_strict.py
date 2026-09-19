"""Строгая сверка с макетом: tools/figma_strict.py <папка>

Ждёт снимки в <папка>/full/*.png (tools/shots.sh). Сравнивает КОНТУРЫ снимка
и кадра Figma, для каждого экрана пишет <папка>/crops/<имя>.jpg — крупные
вырезки каждого расхождения: слева Figma, справа демка. Смотреть нужно
КАЖДЫЙ экран, а не верх рейтинга: мелкие по площади отличия (кегль, отступ,
обрезка картинки) заметны глазу, но почти не дают процентов.
"""
import glob, os, sys
from PIL import Image, ImageChops, ImageFilter, ImageDraw
REF=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","docs","mockup","figma-1920")+"/"  # кадры 1920x1080 из экспорта Figma
if len(sys.argv)>1: os.chdir(sys.argv[1])
os.makedirs("crops",exist_ok=True)
summary=[]
for f in sorted(glob.glob("full/*.png")):
    n=os.path.basename(f)[:-4]; rp=REF+n+".jpg"
    if not os.path.exists(rp): continue
    ref=Image.open(rp).convert("RGB"); W,H=ref.size
    our=Image.open(f).convert("RGB").resize((W,H),Image.LANCZOS)
    # сравниваем контуры: сдвиг панели, кнопки или текста виден, а шум сжатия картинок — нет
    def edges(im): return im.convert("L").filter(ImageFilter.GaussianBlur(0.8)).filter(ImageFilter.FIND_EDGES)
    d=ImageChops.difference(edges(our),edges(ref)).filter(ImageFilter.BoxBlur(2))
    C=8; gw,gh=W//C,H//C
    px=d.resize((gw,gh),Image.BOX).load()
    hot=[[px[x,y]>11 for x in range(gw)] for y in range(gh)]
    seen=[[0]*gw for _ in range(gh)]; boxes=[]
    for y in range(gh):
        for x in range(gw):
            if hot[y][x] and not seen[y][x]:
                st=[(x,y)]; seen[y][x]=1; x0=x1=x; y0=y1=y; cnt=0
                while st:
                    cx,cy=st.pop(); cnt+=1; x0=min(x0,cx);x1=max(x1,cx);y0=min(y0,cy);y1=max(y1,cy)
                    for dx in(-2,-1,0,1,2):
                        for dy in(-2,-1,0,1,2):
                            nx,ny=cx+dx,cy+dy
                            if 0<=nx<gw and 0<=ny<gh and hot[ny][nx] and not seen[ny][nx]: seen[ny][nx]=1; st.append((nx,ny))
                if cnt>=4: boxes.append((cnt,max(0,x0*C-12),max(0,y0*C-12),min(W,(x1+1)*C+12),min(H,(y1+1)*C+12)))
    boxes.sort(reverse=True); boxes=boxes[:6]
    k=1920/W
    summary.append((n,[(round(b[1]*k),round(b[2]*k),round((b[3]-b[1])*k),round((b[4]-b[2])*k)) for b in boxes]))
    if not boxes: continue
    rows=[]
    for c,x0,y0,x1,y1 in boxes:
        a=ref.crop((x0,y0,x1,y1)); b=our.crop((x0,y0,x1,y1))
        s=min(2.0, 560/max(1,a.width)); sz=(max(1,int(a.width*s)),max(1,int(a.height*s)))
        if sz[1]>300: s2=300/sz[1]; sz=(int(sz[0]*s2),300)
        a=a.resize(sz,Image.LANCZOS); b=b.resize(sz,Image.LANCZOS)
        r=Image.new("RGB",(sz[0]*2+6,sz[1]),(255,0,0)); r.paste(a,(0,0)); r.paste(b,(sz[0]+6,0)); rows.append(r)
    Wm=max(r.width for r in rows); m=Image.new("RGB",(Wm,sum(r.height+4 for r in rows)+22),(20,20,20))
    ImageDraw.Draw(m).text((4,4),n+"   слева Figma | справа демка",fill=(255,255,255)); y=22
    for r in rows: m.paste(r,(0,y)); y+=r.height+4
    m.save("crops/"+n+".jpg",quality=80)
for n,b in summary: print("%-16s %d  %s"%(n,len(b)," ".join("[%d,%d %dx%d]"%t for t in b[:4])))
