from fal import *
import concurrent.futures as cf, sys
C=data_uri("/home/user/game-look/shelter/1-domik-razrez-3d.png")
STY=" Same stylized hand-painted 3D game art style, same materials and colors as the reference image. Single object only, centered, fully visible, isolated on a plain flat light-grey background, soft even studio lighting, 3/4 front view, no text, no shadows on background."
P={
"tree":"Take the big oak tree from this image and show ONLY the tree itself: remove every cabin, room, roof, platform, deck, ladder, furniture, lamp and creature. Keep exactly the same trunk shape, the same thick flaring roots, the same big curving side branches and the same clusters of oak leaves, plus the small arched hollow doorway at the bottom right of the trunk. Show the whole tree including the complete top of the canopy, front view, isolated on a plain flat light-grey background, soft even lighting, no fog, no ground.",
"stove":"A small cast-iron wood-burning kitchen stove with an oven door, a warm orange glow in the oven window, and a copper kettle on the cooktop, as in the kitchen of the reference."+STY,
"counter":"A rustic wooden kitchen base cabinet with two doors and a white enamel sink with a brass faucet on top, as in the kitchen of the reference."+STY,
"fridge":"A small rounded retro 1950s refrigerator in pale grey-blue, as in the kitchen of the reference."+STY,
"barrel":"A small wooden barrel with dark iron hoops."+STY,
"bunkbed":"A wooden bunk bed with two mattresses, colorful patchwork quilts and white pillows, and a small wooden ladder at the side, as in the bedroom of the reference."+STY,
"door":"A rustic wooden plank door inside a wooden door frame, with dark iron hinges and a small brass knob, as in the bedroom of the reference."+STY,
"basket":"A woven wicker basket with a lid."+STY,
"workbench":"A sturdy rustic wooden workbench with a vise, a few hand tools and a small cup of pencils on top, as in the workshop of the reference."+STY,
"pegboard":"A wooden pegboard wall panel with neatly hanging hand tools: a saw, hammers, wrenches, pliers and screwdrivers, front view, as in the workshop of the reference."+STY,
"shelf":"A wooden wall shelf unit with three shelves holding old books, glass jars and small tins, as in the workshop of the reference."+STY,
"stool":"A small round three-legged wooden stool."+STY,
"bucket":"A small metal bucket with a handle."+STY,
"telescope":"A brass telescope on a wooden tripod, as on the lookout deck of the reference."+STY,
"table":"A small rustic wooden table with a closed book, a mug and a candle on it."+STY,
"chair":"A simple rustic wooden chair with a slatted back."+STY,
"pendant":"A hanging kitchen pendant lamp: a dark metal cone shade on a short chain with a warm glowing bulb."+STY,
}
keys=sys.argv[1:] or list(P)
def job(k):
    for t in range(3):
        try:
            res=run("fal-ai/nano-banana-pro/edit",{"prompt":P[k],"image_urls":[C],"num_images":1,"aspect_ratio":"3:4" if k=="tree" else "1:1"});get(res["images"][0]["url"],f"ref/{k}.png");return k+" ok"
        except Exception as e: err=e
    return k+" FAIL "+str(err)
with cf.ThreadPoolExecutor(8) as ex:
    for r in ex.map(job,keys):print(r,flush=True)
