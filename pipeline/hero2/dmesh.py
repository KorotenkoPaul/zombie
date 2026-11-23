from fal import *
import json,sys
mode=sys.argv[1]
common={"target_polycount":24000,"topology":"triangle","symmetry_mode":"auto","should_remesh":True,"should_texture":True,"enable_pbr":True}
if mode=="multi":
    res=run("fal-ai/meshy/v6/multi-image-to-3d",dict(common,image_urls=[data_uri("d-front-0.png"),data_uri("d-back.png")]),maxwait=2400)
else:
    res=run("fal-ai/meshy/v6/image-to-3d",dict(common,image_url=data_uri("d-front-0.png")),maxwait=2400)
json.dump(res,open(f"d-{mode}-mesh.json","w"),indent=1);get(res["model_glb"]["url"],f"d-{mode}.glb");print("ok")
