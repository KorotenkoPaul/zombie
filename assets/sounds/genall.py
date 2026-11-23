import json,sys,os,concurrent.futures as cf
sys.path.insert(0,'/home/user/zombie/pipeline')
from fal import run,get
L=json.load(open('list.json'))
def job(k):
  out=f'raw/{k}.mp3'
  if os.path.exists(out):return k,'skip'
  try:
    r=run('fal-ai/elevenlabs/sound-effects/v2',{"text":L[k][0],"duration_seconds":L[k][1],"prompt_influence":0.55},poll=2,maxwait=400)
    get(r['audio']['url'],out);return k,'ok'
  except Exception as e:return k,repr(e)[:200]
os.makedirs('raw',exist_ok=True)
with cf.ThreadPoolExecutor(10) as ex:
  for k,s in ex.map(job,L):print(k,s,flush=True)
