# contact sheet: python3 sheet.py DIR PREFIX OUT.jpg [cols]
import sys,glob,os
from PIL import Image,ImageDraw
d,pre,out=sys.argv[1:4];cols=int(sys.argv[4]) if len(sys.argv)>4 else 8
fs=sorted(glob.glob(os.path.join(d,pre+'*.png')))
if not fs: sys.exit('no frames')
ims=[Image.open(f).convert('RGB') for f in fs];w,h=ims[0].size;sc=.45;W,H=int(w*sc),int(h*sc)
rows=(len(ims)+cols-1)//cols;S=Image.new('RGB',(W*cols,H*rows),(20,20,20))
for i,(im,f) in enumerate(zip(ims,fs)):
  t=im.resize((W,H));ImageDraw.Draw(t).text((4,4),os.path.basename(f).split('_')[1],fill=(255,255,0));S.paste(t,((i%cols)*W,(i//cols)*H))
S.save(out,quality=85);print(out,len(ims))
