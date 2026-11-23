from fal import *
import threading,sys
world=data_uri("world.png");old=data_uri("/home/user/zombie/assets/refs/hero-ref.png")
COMMON=("Full-body 3D game character, the hero who lives alone in this treehouse during a zombie apocalypse. Clearly STYLISED, drawn, hand-painted 3D look (simplified sculpted shapes, painterly textures, like a stylised animated film or Little Nightmares, NOT photorealistic) that fits the attached night treehouse world, "
 "but grounded and NOT cartoony or toy-like: realistic adult proportions (head about 1/7.5 of body height), natural-size eyes, a weathered tired face. "
 "Clothes are worn survivor clothes with real cloth materials: visible wool knit, coarse canvas, scuffed leather, darns, patches, frayed hems, dirt, all matte, nothing glossy. "
 "NO jacket, NO coat, NO quiver, NO backpack, NO bag on the back, nothing in the hands. "
 "Same framing and pose as the second reference image: strict A-pose, arms straight down at about 30 degrees from the body, legs slightly apart, facing the camera, full body head to boots, centered, plain light grey background, soft even studio lighting, no text. ")
jobs={
"c1-quiet":"A lean man of about 27. Short messy dark-brown hair, light stubble, faint scar on the cheekbone, calm watchful eyes. Thick rust-brown hand-knitted wool sweater with darned holes and leather elbow patches, sleeves pushed up a bit, a faded grey-green knitted scarf loosely around the neck, dark olive canvas work trousers with a patched knee, wide leather belt with a small pouch and a knife sheath, worn brown lace-up boots, fingerless wool gloves.",
"c2-nightmare":"In the spirit of Little Nightmares: a thin, slightly lanky young man of about 22 with long limbs, pale skin, dark circles under the eyes, shaggy black hair falling over the forehead. Oversized moth-eaten charcoal wool sweater hanging loose, a long dark-red knitted scarf, baggy grey patched trousers tied with rope at the waist, rolled-up cuffs, battered oversized boots, muted desaturated palette with the scarf as the only colour accent.",
"c3-woodsman":"A sturdy broad-shouldered man of about 32, short beard, tousled chestnut hair, rough weathered hands. Faded red-and-dark-green flannel shirt with rolled sleeves over a dirty cream waffle-knit henley, worn leather suspenders, heavy brown canvas trousers with patched knees and a tool loop, thick wool socks folded over scuffed work boots, a leather wrist guard on one forearm.",
}
def go(k):
    for i in range(2):
        try:
            res=run("fal-ai/nano-banana-pro/edit",{"prompt":COMMON+jobs[k],"image_urls":[world,old],"num_images":1,"aspect_ratio":"1:1","resolution":"2K"})
            get(res["images"][0]["url"],k+"-s.png");print(k,"ok",flush=True);return
        except Exception as e:print(k,"err",e,flush=True)
ts=[threading.Thread(target=go,args=(k,)) for k in jobs];[t.start() for t in ts];[t.join() for t in ts]
