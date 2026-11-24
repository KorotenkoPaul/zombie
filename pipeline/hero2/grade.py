# Grade the hero body texture toward concept 6: richer mustard sweater, warmer lighter leather, olive pants. Soft hue masks.
import sys,numpy as np
from PIL import Image
im=np.array(Image.open(sys.argv[1]).convert('RGB')).astype(np.float32)/255
mx=im.max(2);mn=im.min(2);d=np.maximum(mx-mn,1e-6);r,g,b=im[...,0],im[...,1],im[...,2]
h=np.where(mx==r,((g-b)/d)%6,np.where(mx==g,(b-r)/d+2,(r-g)/d+4))*60;s=np.where(mx>0,(mx-mn)/np.maximum(mx,1e-6),0);v=mx
def band(x,a,b,f):return np.clip(np.minimum((x-a+f)/f,(b+f-x)/f),0,1)
skin=band(h,8,28,4)*band(s,.15,.42,.06)*band(v,.6,1,.08)   # keep skin as is
sw=band(h,28,52,5)*band(s,.3,1,.08)*band(v,.35,1,.1)*(1-skin)
pa=band(h,58,130,8)*band(s,.15,1,.06)
br=band(h,3,28,4)*band(s,.35,1,.08)*band(v,.08,.62,.08)*(1-skin)
SW,PA,BR=[float(x) for x in sys.argv[3].split(',')]  # strength
s2=s*(1+0.14*SW*sw+0.10*BR*br+0.05*PA*pa);v2=v*(1+0.06*SW*sw+0.10*BR*br+0.02*PA*pa)
h2=h-6*PA*pa   # pants a little more olive
s2=np.clip(s2,0,1);v2=np.clip(v2,0,1)
# hsv -> rgb
hh=(h2%360)/60;i=np.floor(hh).astype(int)%6;f=hh-np.floor(hh);p=v2*(1-s2);q=v2*(1-s2*f);t=v2*(1-s2*(1-f))
R=np.choose(i,[v2,q,p,p,t,v2]);G=np.choose(i,[t,v2,v2,q,p,p]);B=np.choose(i,[p,p,t,v2,v2,q])
out=np.stack([R,G,B],-1)
Image.fromarray((np.clip(out,0,1)*255+.5).astype(np.uint8)).save(sys.argv[2])
print('mask px sweater/pants/brown',int((sw>.5).sum()),int((pa>.5).sum()),int((br>.5).sum()))
