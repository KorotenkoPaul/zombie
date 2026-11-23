# contact sheet: side + front stick figures. usage: python3 sheet.py fk.json out.png [n]
import json,sys,numpy as np,matplotlib;matplotlib.use('Agg');import matplotlib.pyplot as plt
d=json.load(open(sys.argv[1]));J=d['joints'];P=np.array(d['P']).reshape(len(d['P']),len(J),3);n=int(sys.argv[3]) if len(sys.argv)>3 else 10
ix={j:i for i,j in enumerate(J)}
E2=[('Hips','Spine2'),('Spine2','Neck'),('Neck','Head'),('Head','HeadTop_End')]+[(f'{s}{a}',f'{s}{b}') for s in('Left','Right') for a,b in [('Shoulder','Arm'),('Arm','ForeArm'),('ForeArm','Hand'),('UpLeg','Leg'),('Leg','Foot'),('Foot','ToeBase'),('ToeBase','Toe_End')]]+[('Spine2','LeftShoulder'),('Spine2','RightShoulder'),('Hips','LeftUpLeg'),('Hips','RightUpLeg')]
fr=np.linspace(0,len(P)-1,n).astype(int)
fig,ax=plt.subplots(3,n,figsize=(2.2*n,7.5))
for k,f in enumerate(fr):
  p=P[f];c=p[ix['Hips']]
  for r,(a,b,ttl) in enumerate([(2,1,'side z-y'),(0,1,'front x-y'),(0,2,'top x-z')]):
    A=ax[r][k];
    for u,v in E2:
      col='r' if u.startswith('Left') or v.startswith('Left') else ('b' if u.startswith('Right') or v.startswith('Right') else 'k')
      A.plot([p[ix[u]][a],p[ix[v]][a]],[p[ix[u]][b],p[ix[v]][b]],col,lw=1.5)
    A.plot(p[ix['HeadTop_End']][a],p[ix['HeadTop_End']][b],'go',ms=4)
    if b==1:A.axhline(0,color='g',lw=.5);A.set_ylim(-.1,2.0);A.set_xlim(c[a]-1,c[a]+1)
    else:A.set_xlim(c[a]-1,c[a]+1);A.set_ylim(c[b]-1,c[b]+1)
    A.set_aspect('equal');A.set_xticks([]);A.set_yticks([])
    if r==0:A.set_title(f'{f/d["fps"]:.1f}s',fontsize=8)
fig.suptitle(d['clip']+'  '+json.dumps(d['metrics'])[:260],fontsize=7);plt.tight_layout();plt.savefig(sys.argv[2],dpi=70)
