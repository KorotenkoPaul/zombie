from PIL import Image
import numpy as np
def seamless(a,b=0.18):
    h,w,_=a.shape;o=np.roll(np.roll(a,h//2,0),w//2,1)
    y=np.minimum(np.arange(h),h-1-np.arange(h))/(h*b);x=np.minimum(np.arange(w),w-1-np.arange(w))/(w*b)
    m=np.clip(np.minimum.outer(np.clip(y,0,1),np.clip(x,0,1)),0,1)[...,None]
    # m=1 in the middle of the original (keep original), 0 at its edges (use shifted copy whose middle is there)
    return a*m+o*(1-m)
def tile(src,out,size=1024,crop=None):
    im=Image.open(src).convert('RGB');W,H=im.size
    if crop is None:crop=(W//2-H//2,0,W//2+H//2,H)
    a=np.asarray(im.crop(crop)).astype(float)
    t=seamless(a)
    Image.fromarray(t.clip(0,255).astype('uint8')).resize((size,size),Image.LANCZOS).save(out,quality=88)
tile('ground.png','../ground2.jpg')
tile('roof.png','../roof2.jpg')
tile('bark.png','../bark2.jpg')
# floor plank atlas: 8 rows between detected seams, full width, wraps along the length
im=Image.open('floor.png').convert('RGB');seams=[136,293,451,607,765,922,1079,1236,1392]
rows=[im.crop((0,seams[i]-3,im.size[0],seams[i+1]+3)).resize((2048,128),Image.LANCZOS) for i in range(8)]
at=Image.new('RGB',(2048,1024))
for i,r in enumerate(rows):
    a=np.asarray(r).astype(float);w=a.shape[1];k=160
    # make the strip wrap along its length
    ramp=np.linspace(0,1,k)[None,:,None];a[:, -k:]=a[:,-k:]*(1-ramp)+a[:,:k]*ramp
    a=a[:,:w-k]
    at.paste(Image.fromarray(a.clip(0,255).astype('uint8')).resize((2048,128)),(0,i*128))
at.save('../floor-atlas.jpg',quality=90)
print('ok')
