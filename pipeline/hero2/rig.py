from fal import *
import json,sys
k=sys.argv[1]
url=json.load(open(k+"-mesh.json"))["model_glb"]["url"]
res=run("fal-ai/meshy/rigging",{"model_url":url,"height_meters":1.6,"skeleton_template":"mixamo","enable_animation":False},maxwait=1800)
json.dump(res,open(k+"-rig.json","w"),indent=1)
u=(res.get("rigged_character_glb") or res.get("model_glb") or {}).get("url")
print(json.dumps(res)[:600]); get(u,k+"-rig.glb");print("ok")
