#!/bin/sh
# Makes demo/footage/talk.mp4: a 55 s synthetic talk with a pricing section to cut
# and the source time burned into the picture, so every cut can be checked by eye.
# macOS only, because it uses `say`. Your own footage works just as well.
set -e
cd "$(dirname "$0")/.."
mkdir -p demo/footage
say -v Samantha -r 175 -f scripts/demo-talk.txt -o demo/footage/talk.aiff
D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 demo/footage/talk.aiff)
ffmpeg -y -v error -f lavfi -i "gradients=size=1280x720:rate=30:speed=0.02:duration=$D" -i demo/footage/talk.aiff \
  -vf "drawtext=text='SOURCE %{pts\:hms}':fontsize=48:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=12:x=40:y=40" \
  -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -c:a aac -b:a 160k -shortest demo/footage/talk.mp4
echo "demo/footage/talk.mp4"
