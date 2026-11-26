import json,sys,numpy as np,collections,bisect
pre=sys.argv[1];d=json.load(open(pre+'.json'));x=np.fromfile(pre+'.f32',dtype=np.float32);sr=d['sr'];t0=d['t0']
print('sr',sr,'dur',len(x)/sr,'peak',float(np.abs(x).max()),'rms',float(np.sqrt((x**2).mean())))
st=d['st'];ts=[s[0] for s in st]
def state(t):
  i=bisect.bisect_right(ts,t)-1;return st[max(i,0)]
TOOL=('hammer','nail','saw','sharpen','stir','scrape','plank','rag','sweep','chop','axe','tool','board')
c=collections.Counter();bad=[]
for e in d['trace']:
  s=state(e[0]);key=(s[2],'lad' if s[3] else '')
  c[(key,e[1])]+=1
  if any(k in e[1] for k in TOOL) and s[2]!='work': bad.append((e[0],e[1],s))
print('tool sounds outside work:',bad[:20])
print('states seen',collections.Counter((s[1],s[2],s[3]) for s in st).most_common(8))
# clicks: second difference spike vs local level
d2=np.abs(x[2:]-2*x[1:-1]+x[:-2]);w=256
loc=np.convolve(d2,np.ones(w)/w,mode='same')
cand=np.where((d2>0.03)&(d2>8*loc+1e-4))[0]
# group
grp=[];last=-10**9
for i in cand:
  if i-last>sr*0.05: grp.append(i)
  last=i
print('click candidates',len(grp))
tr=sorted(d['trace'],key=lambda e:e[0])
for i in grp[:25]:
  t=t0+i/sr;near=[(round(e[0]-t,3),e[1]) for e in tr if abs(e[0]-t)<0.4]
  print(round(t-t0,3),'d2',round(float(d2[i]),3),'loc',round(float(loc[i]),5),'state',state(t)[1:],'near',near[:5])
