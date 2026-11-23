# Footstep sync report for tests/audio/feet_sync.js logs.
# Truth: the moment a swinging foot (median-of-3 speed > 1.2 m/s) slows through .3 m/s (heel strike), refractory .3 s.
# A full step or a soft shuffle within 200 ms of a strike counts as a hit; full steps far from any strike are "extra".
import json,sys
L=json.load(open(sys.argv[1]))
tot={}
for side in 'LR':
  H=[(x[1],x[3],x[4]) for x in L if x[0]=='H' and x[2]==side]
  S=[(x[1],x[3]) for x in L if x[0]=='S' and x[2]==side and x[3]!='rung']
  truth=[];armed=False;last=-9
  for i in range(2,len(H)):
    t,sp,mv=H[i]; t0,sp0,_=H[i-1]
    if t-H[i-2][0]>.2: armed=False; continue
    med=sorted([H[i-2][1],sp0,sp])[1]
    if med>1.2 and t-last>.3: armed=True
    elif armed and sp<=.3 and sp0>.3: truth.append(t0+(t-t0)*(sp0-.3)/(sp0-sp)); armed=False; last=t
  full=[s for s,k in S if k!='shuffle']; shuf=[s for s,k in S if k=='shuffle']
  offs=[];miss=0;soft=0
  for tr in truth:
    c=[s for s in full if abs(s-tr)<.2]
    if c: offs.append(min(c,key=lambda s:abs(s-tr))-tr)
    elif any(abs(s-tr)<.2 for s in shuf): soft+=1
    else: miss+=1
  extra=sum(1 for s in full if not any(abs(s-tr)<.2 for tr in truth))
  offs.sort()
  print(side,'strikes',len(truth),'full steps',len(full),'shuffles',len(shuf),'| hit full',len(offs),'hit soft',soft,'miss',miss,'extra full',extra,
        '| offset ms median %.0f p10 %.0f p90 %.0f'%(offs[len(offs)//2]*1000,offs[len(offs)//10]*1000,offs[len(offs)*9//10]*1000) if offs else '')
print('rungs',len([x for x in L if x[0]=='S' and x[3]=='rung']))
