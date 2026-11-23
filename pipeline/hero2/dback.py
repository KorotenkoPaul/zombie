from fal import *
f=data_uri("d-front-0.png")
res=run("fal-ai/nano-banana-pro/edit",{"prompt":"The SAME character seen exactly from behind (back view), same A-pose, same clothes with the same detail (back of the leather vest with seams, back of knitted sweater, trouser back pockets, boot heels, back of the hair as strands and clumps), full body head to boots, centered, same plain light grey background and lighting, no text.","image_urls":[f],"num_images":1,"aspect_ratio":"1:1","resolution":"2K"})
get(res["images"][0]["url"],"d-back.png");print("ok")
