import json,os,sys,threading,queue
sys.path.insert(0,'/tmp/w')
from fal import run,get
P=json.load(open(sys.argv[1]));out=sys.argv[2];seeds=[int(s) for s in sys.argv[3].split(',')]
os.makedirs(out,exist_ok=True);q=queue.Queue()
for k,(dur,pr) in P.items():
    for s in seeds:q.put((k,dur,pr,s))
def w():
    while True:
        try:k,dur,pr,s=q.get_nowait()
        except queue.Empty:return
        fn=f"{out}/{k}-{s}.json"
        if os.path.exists(fn):continue
        try:
            r=run("fal-ai/hunyuan-motion",{"prompt":pr,"duration":dur,"seed":s,"output_format":"dict","guidance_scale":6},poll=2,maxwait=900)
            get(r["motion_json"]["url"],fn);print(k,s,"ok",flush=True)
        except Exception as e:print(k,s,"err",e,flush=True)
ts=[threading.Thread(target=w) for _ in range(6)];[t.start() for t in ts];[t.join() for t in ts]
