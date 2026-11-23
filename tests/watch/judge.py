#!/usr/bin/env python3
"""HERO WATCH judge: builds numbered contact sheets from a watch.js clip and asks several vision models to review them
like a demanding animator. Usage: python3 tests/watch/judge.py DIR/NN_task [--models gpt-5.5,o3] [--per 12]
Writes DIR/NN_task/sheet_K.jpg and DIR/NN_task/judge.json (per model, per sheet: list of findings)."""
import sys, os, json, glob, base64, urllib.request, concurrent.futures as cf
from PIL import Image, ImageDraw, ImageFont

PROMPT = """You are a demanding senior game animator reviewing a 3D game character (a small stylised survivor boy living in a treehouse).
The image is a contact sheet: {n} consecutive frames left-to-right, top-to-bottom, each labelled with its frame number (60 frames = 1 s)
and the game state (task / animation clip). The camera follows him; it may change angle between frames.
Activity being performed: "{task}". What should happen: {expect}
The clip covers the whole errand: first he walks there (through doors, up/down ladders), then works, then may leave. Judge each phase for what it is (walking, climbing, working); do NOT report that the activity or tool is missing while he is still on the way. Clip names: "30" = walk, "435"/"437" = ladder, hy_* = activity clips.

Find EVERY animation defect you can actually see. Check specifically:
- body parts passing through objects (walls, doors, beds, ladder rungs, furniture, floor), or floating above the floor
- hands not touching what he moves or holds ("magic": objects moving without hand contact, hand far from the handle)
- feet sliding on the floor, wrong foot placement on rungs, feet in the air while 'standing'
- unnatural poses: twisted neck / owl head turn, broken knees or elbows, limbs bent the wrong way, stiff T-pose-like arms
- robotic or slow-motion feel, freezes, sudden pops/teleports between consecutive frames, turning straight back
- facing the wrong way relative to the object he works on, tools in the wrong hand or not held at all
Ignore render quality, lighting, darkness and camera choice. Do not invent problems you cannot see; if the frames look fine say so.
Answer ONLY JSON: {{"ok": bool, "findings": [{{"frames": "f123-f150", "severity": "P1|P2|P3", "what": "short precise description"}}]}}
P1 = obvious at normal play, P2 = noticeable when watching, P3 = minor."""

EXPECT = {
 'tea': 'walks to the kitchen, fills/puts the kettle, makes tea, drinks it holding the cup by hand',
 'chop': 'chops food on the kitchen worktop with a knife in hand', 'pot': 'stirs a pot on the stove with a spoon in hand',
 'stoke': 'opens the oven door by hand and puts wood in, closes it', 'dishes': 'washes dishes at the sink, hands in the sink, dishes in hands',
 'wash': 'washes dishes at the sink', 'saw': 'saws a board at the workbench, one hand on the board, saw in the other',
 'hammer': 'hammers a nail at the workbench', 'sharpen': 'sharpens a blade on a stone', 'fixlamp': 'repairs a lantern held in hands',
 'stretch': 'does a morning stretch', 'diary': 'sits and writes in a diary with a pencil', 'sweep': 'sweeps the floor holding a broom with both hands',
 'water': 'waters a plant with a watering can held by its handle', 'listen': 'stands at a window listening', 'radio': 'sits by the radio and tunes it by hand',
 'telescope': 'looks through the telescope on the deck, hands on it, eye at the eyepiece', 'ledge': 'sits on the landing edge with legs dangling',
 'firewood': 'carries firewood up a ladder', 'supplies': 'counts supplies on shelves', 'hatch': 'closes the floor hatch lid by hand',
 'bolt': 'bolts the door by hand', 'fetchwater': 'walks to the pond, fills a bucket, carries it back by the handle',
 'setbucket': 'lifts the bucket above the sink', 'dumpwater': 'carries the dirty-water bucket outside and empties it',
 'sleep': 'climbs into the bunk bed, lies down with eyes closed in a natural pose', 'read': 'sits and reads a book held in hands',
 'cook': 'cooks at the stove', 'eat': 'sits at the table and eats', 'craft': 'works at the workbench', 'look': 'looks around from the deck',
 'trip': 'goes down to the forest and back', 'store': 'puts meat in the fridge', 'walkabout': 'walks around naturally',
}

def sheets(d, per):
    lp = os.path.join(d, 'log.json'); log = json.load(open(lp))['log'] if os.path.exists(lp) else []
    from PIL import ImageStat
    files = [f for f in sorted(glob.glob(os.path.join(d, 'f*.png'))) if sum(ImageStat.Stat(Image.open(f).convert('L')).mean) > 6]
    bymeta = {e['f']: e for e in log}
    out = []
    try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 15)
    except Exception: font = ImageFont.load_default()
    for k in range(0, len(files), per):
        chunk = files[k:k+per]
        cols = 4; rows = (len(chunk)+cols-1)//cols; S = 360
        im = Image.new('RGB', (cols*S, rows*S), (20, 20, 20))
        for i, f in enumerate(chunk):
            fr = int(os.path.basename(f)[1:7]); m = bymeta.get(fr, {})
            t = Image.open(f).convert('RGB').resize((S, S))
            dr = ImageDraw.Draw(t)
            lab = f"f{fr}  {m.get('task')}/{m.get('clip')}" + ('  LADDER' if m.get('lad') else '') + ('  BED' if m.get('bed') else '')
            dr.rectangle([0, 0, S, 20], fill=(0, 0, 0)); dr.text((4, 2), lab[:44], fill=(255, 255, 0), font=font)
            im.paste(t, ((i % cols)*S, (i//cols)*S))
        p = os.path.join(d, f'sheet_{k//per:02d}.jpg'); im.save(p, quality=85)
        out.append((p, len(chunk), int(os.path.basename(chunk[0])[1:7]), int(os.path.basename(chunk[-1])[1:7])))
    return out

def ask_openai(model, prompt, img):
    b = base64.b64encode(open(img, 'rb').read()).decode()
    body = {'model': model, 'messages': [{'role': 'user', 'content': [{'type': 'text', 'text': prompt},
            {'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,' + b, 'detail': 'high'}}]}]}
    if not model.startswith('gpt-4'): body['reasoning_effort'] = 'medium'
    req = urllib.request.Request('https://api.openai.com/v1/chat/completions', data=json.dumps(body).encode(),
                                 headers={'Authorization': 'Bearer sk-dummy', 'Content-Type': 'application/json'})
    r = json.load(urllib.request.urlopen(req, timeout=300))
    txt = r['choices'][0]['message']['content'].strip()
    s, e = txt.find('{'), txt.rfind('}')
    try: return json.loads(txt[s:e+1])
    except Exception: return {'raw': txt}

def main():
    d = sys.argv[1]
    args = sys.argv[2:]
    models = 'gpt-5.5,o3'
    per = 12
    if '--models' in args: models = args[args.index('--models')+1]
    if '--per' in args: per = int(args[args.index('--per')+1])
    task = os.path.basename(d.rstrip('/')).split('_',1)[1]
    sh = sheets(d, per)
    jobs = []
    with cf.ThreadPoolExecutor(6) as ex:
        for (p, n, a, b) in sh:
            pr = PROMPT.format(n=n, task=task, expect=EXPECT.get(task, task))
            for m in models.split(','):
                jobs.append((m, p, a, b, ex.submit(ask_openai, m, pr, p)))
        res = []
        for (m, p, a, b, fu) in jobs:
            try: r = fu.result()
            except Exception as e: r = {'error': str(e)[:200]}
            res.append({'model': m, 'sheet': os.path.basename(p), 'frames': [a, b], 'result': r})
    json.dump(res, open(os.path.join(d, 'judge.json'), 'w'), indent=1, ensure_ascii=False)
    for r in res:
        fs = r['result'].get('findings') if isinstance(r['result'], dict) else None
        print(r['model'], r['sheet'], r['frames'], 'OK' if (fs == [] ) else json.dumps(fs if fs is not None else r['result'], ensure_ascii=False)[:900])

if __name__ == '__main__':
    main()
