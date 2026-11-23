from fal import *
import threading,json
def go(k,h):
    res=run("fal-ai/meshy/v6/image-to-3d",{"image_url":data_uri(k+"-ref.png"),"pose_mode":"a-pose","enable_pbr":True,"target_polycount":24000,"topology":"triangle","symmetry_mode":"auto","enable_rigging":True,"rigging_height_meters":h,"skeleton_template":"mixamo"},maxwait=2400)
    json.dump(res,open(k+"-model.json","w"),indent=1)
    print(k,list(res.keys()),flush=True)
ts=[threading.Thread(target=go,args=a) for a in [("hero",1.6),("zombie",1.75)]];[t.start() for t in ts];[t.join() for t in ts]
