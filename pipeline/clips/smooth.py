import json,sys,numpy as np
C=json.load(open(sys.argv[1]));sig=float(sys.argv[3]);F=C['frames'];R=int(3*sig)
w=np.exp(-np.arange(-R,R+1)**2/(2*sig*sig))
for b,a in C['tracks'].items():
  q=np.array(a).reshape(F,4)
  for i in range(1,F):
    if (q[i]*q[i-1]).sum()<0: q[i]=-q[i]
  o=np.zeros_like(q)
  for i in range(F):
    idx=np.clip(np.arange(i-R,i+R+1),0,F-1);o[i]=(q[idx]*w[:,None]).sum(0)
  o/=np.linalg.norm(o,axis=1)[:,None];C['tracks'][b]=[round(float(v),5) for v in o.ravel()]
h=np.array(C['hips']).reshape(F,3);o=np.zeros_like(h)
for i in range(F):
  idx=np.clip(np.arange(i-R,i+R+1),0,F-1);o[i]=(h[idx]*w[:,None]).sum(0)/w.sum()
C['hips']=[round(float(v),4) for v in o.ravel()];json.dump(C,open(sys.argv[2],'w'))
