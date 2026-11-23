from fal import *
import threading
P=("Keep this exact image, character, pose, clothes, hair, colours, framing and background. Change only the rendering style of the face and hands to be less anime/cartoon and more like a high-quality realistic-stylised game character "
 "(like a premium modern 3D adventure game): eyes a natural human size (smaller than now), realistic irises, subtle eyelids, natural nose and lips, skin with fine pores and subtle colour variation, same young teenage age and same face shape. "
 "Make the hair read as many fine strands and clumps rather than solid plastic chunks. Make every fabric more realistic: wool knit, cracked worn leather, twill trousers with seams and folds.")
def go(src,out):
    res=run("fal-ai/nano-banana-pro/edit",{"prompt":P,"image_urls":[data_uri(src)],"num_images":1,"aspect_ratio":"1:1","resolution":"2K"})
    get(res["images"][0]["url"],out);print(out,"ok",flush=True)
ts=[threading.Thread(target=go,args=a) for a in [("d-front-0.png","r-front.png"),("d-back.png","r-back.png")]];[t.start() for t in ts];[t.join() for t in ts]
