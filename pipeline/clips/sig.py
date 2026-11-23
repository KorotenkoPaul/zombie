import json,sys,numpy as np
d=json.load(open(sys.argv[1]));J=d['joints'];P=np.array(d['P']).reshape(len(d['P']),len(J),3);fps=d['fps']
j=J.index(sys.argv[2] if len(sys.argv)>2 else 'RightHand');st=int(fps*float(sys.argv[3])) if len(sys.argv)>3 else 6
print(' '.join(f"{i/fps:.1f}:{P[i,j,1]:.2f}" for i in range(0,len(P),st)))
