import json,sys
L=json.load(open(sys.argv[1]))
for side in 'LR':
  H=[(x[1],x[3],x[4]) for x in L if x[0]=='H' and x[2]==side]
  S=[x[1] for x in L if x[0]=='S' and x[2]==side and x[3]!='rung']
  truth=[];armed=False
  for i in range(1,len(H)):
    t,sp,mv=H[i]; t0,sp0,_=H[i-1]
    if t-t0>.2: armed=False; continue
    if sp>5: armed=False; continue
    if sp>.3 and abs(sp-mv)<.005: continue
    if sp>1.2: armed=True
    elif armed and sp<=.3 and sp0>.3: truth.append(t0+(t-t0)*(sp0-.3)/(sp0-sp)); armed=False
  offs=[];miss=0
  for tr in truth:
    c=[s for s in S if abs(s-tr)<.2]
    if c: offs.append(min(c,key=lambda s:abs(s-tr))-tr)
    else: miss+=1
  extra=sum(1 for s in S if not any(abs(s-tr)<.2 for tr in truth))
  offs.sort()
  if offs: print(side,'contacts',len(truth),'steps',len(S),'miss',miss,'extra',extra,'offset ms: median %.0f  p10 %.0f  p90 %.0f  max|%.0f|'%(offs[len(offs)//2]*1000,offs[len(offs)//10]*1000,offs[len(offs)*9//10]*1000,max(abs(o) for o in offs)*1000))
  else: print(side,'contacts',len(truth),'steps',len(S))
print('rungs',len([x for x in L if x[0]=='S' and x[3]=='rung']))
