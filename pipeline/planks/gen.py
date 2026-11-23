import sys,json;sys.path.insert(0,'..')
from fal import run,get
P={
'floor':"Top-down orthographic photograph of the surface of one wide old weathered pine floorboard, filling the entire frame edge to edge, wood grain running perfectly horizontal left to right, warm amber honey and caramel brown tones, long flowing grain lines, subtle cathedral grain, a couple of small dark knots, fine scratches, worn and slightly dirty, soft even diffuse lighting, no shadows, no board edges, no gaps, no nails, highly detailed PBR texture scan, 8k realism",
'wall':"Top-down orthographic photograph of the surface of one wide old pine wall plank, filling the entire frame edge to edge, wood grain running perfectly horizontal left to right, light warm honey and pale golden tones, gentle straight grain, faint small knots, slightly weathered matte unvarnished wood, soft even diffuse lighting, no shadows, no board edges, no gaps, no nails, highly detailed PBR texture scan, realistic",
'dark':"Top-down orthographic photograph of the surface of an old dark weathered oak beam, filling the entire frame edge to edge, wood grain running perfectly horizontal, deep brown with grey weathering, open grain cracks and checks, rough sawn, soft even diffuse lighting, no shadows, no edges, highly detailed PBR texture scan, realistic"}
k=sys.argv[1]
r=run("fal-ai/nano-banana-pro",{"prompt":P[k],"aspect_ratio":"21:9","resolution":"2K","num_images":1})
print(json.dumps(r)[:300]);get(r["images"][0]["url"],k+".png")
