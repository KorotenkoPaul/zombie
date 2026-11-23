from fal import *
ref=data_uri("../shelter/1-domik-razrez-3d.png");ref4=data_uri("../shelter/4-domik-noch-miniatura.png")
jobs={
"hero":("Full-body 3D game character for this treehouse world, same stylized art style as the reference: a young cozy forest survivor (gender-neutral, slim), brown leather vest over a mustard sweater, dark green trousers, sturdy boots, short brown hair, a small quiver on the back, no bow in hands. Standing in a strict A-pose, arms straight down at 30 degrees away from the body, legs slightly apart, facing the camera directly, full body head to feet, centered, plain light grey background, even studio lighting, no props, no text.",ref),
"zombie":("Full-body 3D game character in the same stylized art style as the reference: a gaunt forest zombie / ghoul, dark grey-green skin, glowing yellow eyes, torn ragged dark clothes, long thin arms. Standing in a strict A-pose, arms straight down at 30 degrees away from the body, legs slightly apart, facing the camera directly, full body head to feet, centered, plain light grey background, even studio lighting, no props, no text.",ref4),
}
import threading
def go(k):
    p,r=jobs[k];res=run("fal-ai/nano-banana-pro/edit",{"prompt":p,"image_urls":[r],"num_images":1,"aspect_ratio":"1:1"});get(res["images"][0]["url"],k+"-ref.png");print(k,"ok",flush=True)
ts=[threading.Thread(target=go,args=(k,)) for k in jobs];[t.start() for t in ts];[t.join() for t in ts]
