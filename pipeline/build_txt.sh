#!/bin/sh
# Rebuild the base64 model files the game loads (the artifact host does not serve .glb).
# Run from the repo root: sh pipeline/build_txt.sh
set -e
for f in assets/models/*.glb; do n=$(basename "$f" .glb); base64 -w0 "$f" > "game/$n-glb.txt"; done
echo done
