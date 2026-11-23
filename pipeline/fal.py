import json,time,urllib.request,base64,sys
def run(ep,body,poll=4,maxwait=1800):
    r=urllib.request.Request(f"https://queue.fal.run/{ep}",data=json.dumps(body).encode(),headers={"Content-Type":"application/json"})
    j=json.load(urllib.request.urlopen(r,timeout=120));rid=j["request_id"];st_url=j["status_url"];res_url=j["response_url"]
    t0=time.time()
    while time.time()-t0<maxwait:
        st=json.load(urllib.request.urlopen(st_url,timeout=30)).get("status")
        if st=="COMPLETED":break
        time.sleep(poll)
    return json.load(urllib.request.urlopen(res_url,timeout=120))
def data_uri(p,mime="image/png"):return f"data:{mime};base64,"+base64.b64encode(open(p,"rb").read()).decode()
def get(url,out):urllib.request.urlretrieve(url,out)
