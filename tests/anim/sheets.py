# Builds storyboard contact sheets and the walk map from tests/anim/shots.js output.
import json,sys,os,glob,gzip
from PIL import Image,ImageDraw,ImageFont
D=sys.argv[1];P=json.load(open(D+'/picked.json'))['pick']
try:F=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',13);FB=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',15)
except Exception:F=FB=ImageFont.load_default()
OFF=[-30,-12,-4,0,4,12]
for n,q in enumerate(P):
  W=240;slow=q['type'] in('detour','crab-walk','sharp-turn','foot-slide');offs=[o*2 for o in OFF] if slow else OFF
  sheet=Image.new('RGB',(W*6,W*2+58),(20,22,28));d=ImageDraw.Draw(sheet)
  title=f"P{q['P']} {q['type']}  t={q['t']}s (frame {q['f']})  {q['act']}  [{q['clip']}]"
  sub=f"{q['bone']}: {q['value']} {q['unit']}"+(f"  into {q['into']}" if q.get('into') else '')+(f"  ({q['what']})" if q.get('what') else '')+f"   limit {q.get('limit')}"
  d.text((8,6),title,font=FB,fill=(255,220,120));d.text((8,28),sub,font=F,fill=(230,230,230))
  for k,o in enumerate(offs):
    for v in (0,1):
      f=f"{D}/raw/sheet_{n:02d}_{k}_{v}.png"
      if not os.path.exists(f):continue
      im=Image.open(f).convert('RGB').resize((W,W));sheet.paste(im,(k*W,58+v*W))
      if o==0:d.rectangle([k*W,58+v*W,k*W+W-1,58+v*W+W-1],outline=(255,60,60),width=3)
    d.text((k*W+6,62),f"{'+' if o>=0 else ''}{o} fr ({o/60:+.2f}s)",font=F,fill=(255,255,255))
  sheet.save(f"{D}/sheets/{n:02d}_P{q['P']}_{q['type']}.jpg",quality=86)
# walk map (top view)
R=json.load(open(D+'/issues.json'));walks=R['walks']
levels={}
for w in walks:
  y=round(w['pts'][0][2]);levels.setdefault(y,[]).append(w)
xs=[p[0] for w in walks for p in w['pts']];zs=[p[1] for w in walks for p in w['pts']]
if xs:
  x0,x1,z0,z1=min(xs)-.5,max(xs)+.5,min(zs)-.5,max(zs)+.5;S=160
  ks=sorted(levels);img=Image.new('RGB',(int((x1-x0)*S)*len(ks)+10*len(ks),int((z1-z0)*S)+40),(245,242,235));d=ImageDraw.Draw(img)
  cols=[(200,40,40),(40,90,200),(20,140,60),(160,60,170),(220,120,0),(0,150,160),(110,110,110)]
  for li,y in enumerate(ks):
    ox=li*(int((x1-x0)*S)+10);d.text((ox+6,4),f"floor y~{y} m",font=FB,fill=(0,0,0))
    for i,w in enumerate(levels[y]):
      pts=[(ox+(p[0]-x0)*S,30+(p[1]-z0)*S) for p in w['pts']];c=cols[i%len(cols)]
      if len(pts)>1:d.line(pts,fill=c,width=2)
      d.ellipse([pts[0][0]-4,pts[0][1]-4,pts[0][0]+4,pts[0][1]+4],outline=c,width=2);d.rectangle([pts[-1][0]-4,pts[-1][1]-4,pts[-1][0]+4,pts[-1][1]+4],fill=c)
      d.text((pts[-1][0]+5,pts[-1][1]-6),f"{w['task']} {w['L']/max(w['D'],.01):.2f}",font=F,fill=c)
  img.save(D+'/walks.png')
print('sheets',len(P))
