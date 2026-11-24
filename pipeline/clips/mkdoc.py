import json,glob,os
R=json.load(open('/tmp/w/recipes.json'))
loops={'stool_sit_idle':.8,'eat_sit':.6,'chop_axe':.3,'hammer_stand':.6,'hammer_kneel':.6,'saw_hand':.6,'stir_stand':.8,'squat_work':.6,'wash_hands_front':.8,'wipe_window':.6,'sweep':.8,'chop_axe_long':.4,'ledge_dangle':.8,'idle_stand_a':1,'idle_stand_b':.8,'idle_stand_c':1,'idle_wait':1,'idle_tired':1,'sit_ground':1,'reach_up_hold':.6,'look_around':1,'sit_tired':.8,'telescope_look':.8}
rows=[]
for f in sorted(glob.glob('/tmp/w/outfk/*.json')):
    n=os.path.basename(f)[:-5]
    if n not in R: continue
    m=json.load(open(f))['metrics'];e={"src":n,"smooth":1}
    if n in loops:e.update(loop=True,close=loops[n])
    if n.startswith('bed_') or n.startswith('stool_s') and 'idle' not in n or n in('squat_pickup','box_pickup_knees'): e['rm']=True
    rows.append((n,m,e,R[n]['note']))
L=open('/tmp/w/CLIPS.head').read().split('\n')
for n,m,e,note in rows:
    L.append(f"| {n} | {m['dur']} | {m['kneeBackFrames']['L']+m['kneeBackFrames']['R']} | {m['footSlideMps']} | {m['hipsY'][0]}-{m['hipsY'][1]} | `\"{n}\": {json.dumps(e)}` | {note} |")
L+=open('/tmp/w/CLIPS.tail').read().split('\n')
open('/tmp/w/CLIPS.md','w').write('\n'.join(L));print(len(rows),'clips')
