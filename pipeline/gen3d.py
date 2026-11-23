from fal import *
import concurrent.futures as cf, sys, json
def tree():
    res=run("fal-ai/meshy/v6/image-to-3d",{"image_url":data_uri("ref/tree.png"),"target_polycount":120000,"topology":"triangle","symmetry_mode":"off","enable_pbr":False},maxwait=2400)
    json.dump(res,open("m/tree.json","w"));get(res["model_glb"]["url"],"m/tree.glb");return "tree ok"
def prop(k):
    try:
        res=run("fal-ai/trellis",{"image_url":data_uri(f"ref/{k}.png"),"texture_size":1024,"mesh_simplify":0.95,"ss_sampling_steps":20,"slat_sampling_steps":20},maxwait=1200)
        get(res["model_mesh"]["url"],f"m/{k}.glb");return k+" ok"
    except Exception as e:return k+" FAIL "+str(e)[:200]
keys=sys.argv[1:]
with cf.ThreadPoolExecutor(10) as ex:
    fs=[ex.submit(prop,k) for k in keys if k!='tree']
    if not keys or 'tree' in keys: fs.append(ex.submit(tree))
    for f in cf.as_completed(fs):print(f.result(),flush=True)
