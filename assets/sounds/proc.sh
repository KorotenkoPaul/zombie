for f in raw/*.mp3; do k=$(basename $f .mp3);
dn=""; case $k in fox_a|grasshopper_a|nightjar_a|rustle_b|tit_b|blackbird_a|woodpecker_a|branch_a|bullfinch_a|cricket_b|bcreak_*) dn=",afftdn=nf=-45:nr=10";; esac
hp="highpass=f=90"; case $k in wolf*|owl*|frog*|toad*|rain*|fire*|windw*|rustle*|step*|creak*|dove*|raven*|bcreak*) hp="highpass=f=45";; esac
th=-50; case $k in branch*|drip*) th=-68;; esac
bed=0; case $k in rain*|fire*) bed=1;; esac
if [ $bed = 1 ]; then trim=""; else trim=",silenceremove=start_periods=1:start_threshold=${th}dB,areverse,silenceremove=start_periods=1:start_threshold=${th}dB,areverse"; fi
ffmpeg -v error -y -i $f -ac 1 -af "$hp$dn$trim" -ar 32000 tmp.wav
peak=$(ffmpeg -hide_banner -i tmp.wav -af volumedetect -f null - 2>&1 | grep max_volume | awk '{print $5}')
g=$(python3 -c "print(-1-($peak))"); d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 tmp.wav)
fo=$(python3 -c "print(max(0,$d-0.25))")
ffmpeg -v error -y -i tmp.wav -af "volume=${g}dB,afade=t=in:d=0.02,afade=t=out:st=$fo:d=0.25" -c:a libmp3lame -b:a 56k out/$k.mp3
echo "$k $(printf %.1f $d)"
done
