from fal import *
import json
res=run("fal-ai/meshy/v6/image-to-3d",{"image_url":data_uri("tree-ref.png"),"target_polycount":90000,"topology":"triangle","symmetry_mode":"off","enable_pbr":False},maxwait=2400)
json.dump(res,open("tree-model.json","w"),indent=1);get(res["model_glb"]["url"],"tree.glb");print("tree ok")
