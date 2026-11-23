from fal import *
import json,threading,queue,os
H=json.load(open("hero-model.json"))["model_glb"]["url"];Z=json.load(open("zombie-model.json"))["model_glb"]["url"]
jobs=[("hero",H,1.6,a) for a in [0,231,224,267,33,128,276,438,184]]+[("zombie",Z,1.75,a) for a in [113,444,438,198,386,183,502,178,111]]
q=queue.Queue();[q.put(j) for j in jobs]
def worker():
    while True:
        try:k,u,h,a=q.get_nowait()
        except queue.Empty:return
        out=f"anims/{k}-{a}.glb"
        if os.path.exists(out):continue
        for attempt in range(2):
            try:
                res=run("fal-ai/meshy/rigging",{"model_url":u,"height_meters":h,"skeleton_template":"mixamo","enable_animation":True,"animation_action_id":a},maxwait=1500)
                url=(res.get("animation_glb") or {}).get("url")
                if not url:print(k,a,"no anim",json.dumps(res)[:300],flush=True);break
                get(url,out);print(k,a,"ok",os.path.getsize(out),flush=True);break
            except Exception as e:print(k,a,"err",e,flush=True)
ts=[threading.Thread(target=worker) for _ in range(3)];[t.start() for t in ts];[t.join() for t in ts]
