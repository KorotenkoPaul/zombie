# sheet over a window: python3 win.py fk.json out.png t0 t1 n
import json,sys,subprocess,numpy as np
d=json.load(open(sys.argv[1]));fps=d['fps'];a,b=int(float(sys.argv[3])*fps),int(float(sys.argv[4])*fps)
d['P']=d['P'][a:b+1];d['clip']+=f' [{sys.argv[3]}-{sys.argv[4]}]';json.dump(d,open('/tmp/w/_win.json','w'))
subprocess.run(['python3','/tmp/w/sheet.py','/tmp/w/_win.json',sys.argv[2],sys.argv[5]])
