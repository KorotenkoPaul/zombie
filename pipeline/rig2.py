from fal import *
import json,threading,queue,os
H=json.load(open("hero-model.json"))["model_glb"]["url"]
acts=[435,436,437,57,53,371,271,269,30,576,586,336,338,343,342,11,12]
q=queue.Queue();[q.put(a) for a in acts]
def worker():
    while True:
        try:a=q.get_nowait()
        except queue.Empty:return
        out=f"anims/hero-{a}.glb"
        if os.path.exists(out):continue
        for attempt in range(2):
            try:
                res=run("fal-ai/meshy/rigging",{"model_url":H,"height_meters":1.6,"skeleton_template":"mixamo","enable_animation":True,"animation_action_id":a},maxwait=1500)
                url=(res.get("animation_glb") or {}).get("url")
                if not url:print(a,"no anim",json.dumps(res)[:300],flush=True);break
                get(url,out);print(a,"ok",os.path.getsize(out),flush=True);break
            except Exception as e:print(a,"err",e,flush=True)
ts=[threading.Thread(target=worker) for _ in range(5)];[t.start() for t in ts];[t.join() for t in ts]
