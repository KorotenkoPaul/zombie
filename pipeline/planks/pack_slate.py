# Fal slate + moss scans -> seamless textures for the roof shingle shader
from PIL import Image,ImageFilter
import numpy as np
from pack import seamless
for k,out,crop,size in [('slate','../../game/slate.jpg',(.1,.1,.9,.9),1024),('moss','../../game/moss.jpg',(.15,.2,.75,.8),512)]:
    im=Image.open(k+'.png').convert('RGB');W,H=im.size;im=im.crop((int(crop[0]*W),int(crop[1]*H),int(crop[2]*W),int(crop[3]*H))).resize((size,size),Image.LANCZOS)
    a=np.asarray(im).astype(float);blur=np.asarray(im.filter(ImageFilter.GaussianBlur(size//8))).astype(float)
    a=a/np.maximum(blur,1)*blur.mean(axis=(0,1))
    Image.fromarray(seamless(a).clip(0,255).astype('uint8')).save(out,quality=85,optimize=True,progressive=True)
