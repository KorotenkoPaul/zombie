# self-penetration + posture per clip from fk json. usage: python3 pen.py fk1.json ...
import json,sys,numpy as np
def segd(p1,q1,p2,q2):
    d1=q1-p1;d2=q2-p2;r=p1-p2;a=d1@d1;e=d2@d2;f=d2@r;c=d1@r;b=d1@d2;den=a*e-b*b
    s=np.clip((b*f-c*e)/den,0,1) if den>1e-9 else 0.0
    t=(b*s+f)/e if e>1e-9 else 0.0
    if t<0: t=0;s=np.clip(-c/a,0,1)
    elif t>1: t=1;s=np.clip((b-c)/a,0,1)
    return np.linalg.norm(p1+d1*s-(p2+d2*t))
for fn in sys.argv[1:]:
    d=json.load(open(fn));J=d['joints'];P=np.array(d['P']).reshape(len(d['P']),len(J),3);g=lambda f,n:P[f,J.index(n)]
    caps={'torso':('Hips','Neck',.12),'head':('Neck','HeadTop_End',.09)}
    for s in('Left','Right'):
        caps[s+'Fore']=(s+'ForeArm',s+'Hand',.035);caps[s+'Thigh']=(s+'UpLeg',s+'Leg',.065);caps[s+'Shin']=(s+'Leg',s+'Foot',.045);caps[s+'FootS']=(s+'Foot',s+'Toe_End',.04)
    pairs=[('LeftFore','torso'),('RightFore','torso'),('LeftFore','RightFore'),('LeftThigh','RightThigh'),('LeftShin','RightShin'),('LeftFootS','RightShin'),('RightFootS','LeftShin'),('LeftFootS','RightFootS'),('LeftFore','LeftThigh'),('RightFore','RightThigh'),('LeftFore','head'),('RightFore','head')]
    worst={};lean=[]
    for f in range(len(P)):
        for a,b in pairs:
            A,B=caps[a],caps[b];dd=segd(g(f,A[0]),g(f,A[1]),g(f,B[0]),g(f,B[1]))-A[2]-B[2]
            if dd<worst.get(a+'/'+b,(9,0))[0]:worst[a+'/'+b]=(dd,f)
        sp=g(f,'Neck')-g(f,'Hips');lean.append(np.degrees(np.arccos(sp[1]/np.linalg.norm(sp))))
    bad={k:(round(v[0]*100),round(v[1]/30,1)) for k,v in worst.items() if v[0]<-0.03}
    print(fn.split('/')[-1][:-5].ljust(24),'spineLean max',int(max(lean)),'| penetration >3cm (cm,at s):',bad)
