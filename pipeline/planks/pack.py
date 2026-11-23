# Fal wood scans -> seamless (wraps both ways) 2048x1024 textures for the per-board plank shader
from PIL import Image
import numpy as np
def seamless(a,b=0.2):
    h,w,_=a.shape;o=np.roll(np.roll(a,h//2,0),w//2,1)
    y=np.minimum(np.arange(h),h-1-np.arange(h))/(h*b);x=np.minimum(np.arange(w),w-1-np.arange(w))/(w*b)
    m=np.clip(np.minimum.outer(np.clip(y,0,1),np.clip(x,0,1)),0,1)[...,None];m=m*m*(3-2*m)
    return a*m+o*(1-m)
for k,out in [('floor','wood-floor.jpg'),('wall','wood-wall.jpg'),('dark','wood-dark.jpg')]:
    a=np.asarray(Image.open(k+'.png').convert('RGB').resize((2048,1024),Image.LANCZOS)).astype(float)
    # flatten big lighting gradients so tiling doesn't show
    from PIL import ImageFilter
    blur=np.asarray(Image.fromarray(a.astype('uint8')).filter(ImageFilter.GaussianBlur(160))).astype(float)
    a=a/np.maximum(blur,1)*blur.mean(axis=(0,1))
    t=seamless(a)
    Image.fromarray(t.clip(0,255).astype('uint8')).save('../../game/'+out,quality=86,optimize=True,progressive=True)
