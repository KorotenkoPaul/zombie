from fal import *
import json,sys
k=sys.argv[1]
res=run("fal-ai/meshy/v6/image-to-3d",{"image_url":data_uri(k+"-s.png"),"target_polycount":22000,"topology":"triangle","symmetry_mode":"auto","should_remesh":True,"should_texture":True,"enable_pbr":False,"texture_prompt":"stylised hand-painted matte cloth: wool knit sweater, canvas trousers, leather belt and boots"},maxwait=2400)
json.dump(res,open(k+"-mesh.json","w"),indent=1);get(res["model_glb"]["url"],k+".glb");print("ok")
