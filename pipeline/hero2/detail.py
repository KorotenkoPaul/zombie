from fal import *
import threading
old=data_uri("/home/user/zombie/assets/refs/hero-ref.png")
BASE=("Recreate EXACTLY this same character: identical face, identical young age, identical hairstyle and hair colour, identical proportions, identical clothes and colours "
 "(mustard knitted sweater, brown leather vest, dark green trousers, brown lace-up boots). Keep the same stylised animated-film look, but make it much more DETAILED and higher quality, like a premium 3D game character: "
 "visible wool knit stitches and ribbing on the sweater, worn creased leather with scuffs, stitching and seams on the vest, twill weave, seams and soft folds on the trousers, scuffed leather and laces on the boots, "
 "hair as defined strands and clumps, natural skin with subtle colour variation and slight freckles, realistic hands with defined fingers. Matte, nothing glossy. "
 "REMOVE the quiver, the arrows and the shoulder strap completely. ")
jobs={
"d-front":BASE+"Same strict A-pose, facing the camera, full body head to boots, centered, plain light grey background, soft even studio lighting, no text.",
}
def go(k,refs=None):
    res=run("fal-ai/nano-banana-pro/edit",{"prompt":jobs[k],"image_urls":refs or [old],"num_images":2,"aspect_ratio":"1:1","resolution":"2K"})
    for i,im in enumerate(res["images"]):get(im["url"],f"{k}-{i}.png")
    print(k,"ok",flush=True)
go("d-front")
