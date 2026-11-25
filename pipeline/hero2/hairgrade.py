# Hair (and brows, lashes, irises: same dark red-brown family) toward concept 6's warm chocolate brown. The generated head's
# hair texels average sRGB (93,45,31): a deep maroon that reads near-black red in the game; concept 6 hair is (~128,84,58) with
# light locks. Each texel keeps its brightness relative to the hair mean (contrast pushed a little so locks read) and takes
# the target hue; blended by a soft mask so the hairline into the skin stays smooth.
# usage: python3 hairgrade.py in.png out.png '{"t":[128,84,58],"g":1.25}'
import sys,json;import numpy as np;from PIL import Image
C=dict(t=[128,84,58],g=1.25,k=1.0);C.update(json.loads(sys.argv[3]) if len(sys.argv)>3 else {})
a=np.array(Image.open(sys.argv[1]).convert('RGB')).astype(np.float32)/255
lin=a**2.2;mx=a.max(2);mn=a.min(2);sat=(mx-mn)/np.maximum(mx,1e-3)
sm=lambda x,e0,e1:np.clip((x-e0)/(e1-e0),0,1)**2*(3-2*np.clip((x-e0)/(e1-e0),0,1))
m=(1-sm(mx,.55,.68))*sm(sat,.35,.5)*(a[...,0]>a[...,1])
L=(lin*[.2126,.7152,.0722]).sum(2);lm=np.median(L[m>.9])
T=(np.array(C['t'],np.float32)/255)**2.2;Tl=(T*[.2126,.7152,.0722]).sum()
f=(L/lm)**C['g']
out=T[None,None,:]*f[...,None]*C['k']
out=np.clip(out,0,1)**(1/2.2)
res=a*(1-m[...,None])+out*m[...,None]
Image.fromarray((np.clip(res,0,1)*255+.5).astype(np.uint8)).save(sys.argv[2])
print('hair texels',float((m>.5).mean()),'mean before',(a[m>.9].mean(0)*255).round(),'after',(res[m>.9].mean(0)*255).round())
