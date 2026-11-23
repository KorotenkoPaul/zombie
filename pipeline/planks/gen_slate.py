import sys,json;sys.path.insert(0,'..')
from fal import run,get
P={'slate':"Top-down orthographic photograph of the flat surface of one large old natural roofing slate stone, filling the entire frame edge to edge, dark blue-grey slate with subtle cool blue and charcoal tones, fine natural cleavage layers and flaky split texture, faint pale lichen specks, slightly weathered, soft even diffuse lighting, no shadows, no edges, no gaps, highly detailed PBR texture scan, realistic",
'moss':"Top-down orthographic photograph of a dense cushion of green moss growing on stone, filling the entire frame edge to edge, deep green and yellow-green tones, fine detail, soft even diffuse lighting, no shadows, highly detailed PBR texture scan, realistic"}
k=sys.argv[1]
r=run("fal-ai/nano-banana-pro",{"prompt":P[k],"aspect_ratio":"1:1","resolution":"2K","num_images":1})
get(r["images"][0]["url"],k+".png");print('ok')
