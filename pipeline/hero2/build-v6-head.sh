set -e
# $1 = head scale factor K vs the boxed head, $2 = out.glb, $3 = chinOut, $4 = zc
K=$1;CO=${3:-0.61};ZC=${4:--0.04}
S=$(python3 -c "print(0.205*$K)")
node graft.mjs sh13.glb hd-single.glb G.glb "{\"s\":$S,\"chinIn\":-0.5,\"chinOut\":$CO,\"zc\":$ZC,\"cut\":0.58,\"ycut\":${YCUT:--0.76}${HAIRFIT:+,$HAIRFIT}}" | grep -v prune
F=0.5 node skintone.mjs G.glb Gt.glb | cut -c1-120
[ -n "$GRADE" ] && bash gradestep.sh
[ -n "$FACEPOP" ] && node facepop.mjs Gt.glb Gt.glb "$FACEPOP" | tail -1
[ -n "$BOOTS" ] && node bootlift.mjs Gt.glb Gt.glb "$BOOTS"
[ -n "$BACKW" ] && node backweights.mjs Gt.glb Gt.glb "$BACKW"
[ -n "$VESTK" ] && node vesttone.mjs Gt.glb Gt.glb "$VESTK"
[ -n "$BOOTS2" ] && node bootlift.mjs Gt.glb Gt.glb "$BOOTS2"
[ -n "$SLEEVE" ] && node sleeves.mjs Gt.glb Gt.glb "$SLEEVE"
[ -n "$UNDERV" ] && node undervest.mjs Gt.glb Gt.glb "$UNDERV" | tail -2
L=$(python3 -c "
K=$K;CO=$CO;ZC=$ZC
f=lambda x,y:[round(x*K,4),round(CO+(y-0.625)*K,4)]
import json
L=f(-0.0388,0.7415)+[round(0.047*K,4),round(0.031*K,4)];R=f(0.0412,0.7415)+[round(0.047*K,4),round(0.031*K,4)]
print(json.dumps({'L':L,'R':R,'skin':f(-0.06,0.735),'lash':f(-0.0388,0.7535),'off':0.0016*K,'ymin':0.68,'pow':0.33,'flat':1}))")
PRIM=1,2 node lids.mjs Gt.glb GL.glb "$L" | tail -1
[ -n "$SHADOW" ] && node shadowproxy.mjs GL.glb GL.glb $SHADOW
[ -n "$FACEM" ] && node facemorph.mjs GL.glb GL.glb "$FACEM" | tail -1
[ -n "$HANDM" ] && node handmorph.mjs GL.glb GL.glb "$HANDM" | grep ring
HEADS=1024 node ktxtex.mjs GL.glb K.glb 2048 1024 2>&1 | grep -E "KB$" >/dev/null
node quant.mjs K.glb Q.glb && node optim.mjs Q.glb $2 0.65 >/dev/null && base64 -w0 $2 > ${2%.glb}.txt && ls -la ${2%.glb}.txt
node hp2.mjs Gt.glb | head -3
