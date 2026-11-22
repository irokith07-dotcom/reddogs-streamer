#!/bin/bash
# 1. Clean broken partial files and purge npm cache to free ~200MB disk space
rm -f dashboard/videos/*.part dashboard/videos/*.tmp 2>/dev/null
rm -rf ~/.npm ~/.cache /home/container/.npm /tmp/* 2>/dev/null

# 2. Check standalone yt-dlp binary for Linux (only if space permits)
if [ ! -f ./yt-dlp ] || [ $(wc -c < ./yt-dlp 2>/dev/null || echo 0) -lt 5000000 ]; then
  FREE_KB=$(df -k . 2>/dev/null | awk 'NR==2 {print $4}' || echo 999999)
  if [ "$FREE_KB" -gt 60000 ]; then
    echo "Downloading standalone yt-dlp_linux binary..."
    rm -f ./yt-dlp 2>/dev/null
    curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o ./yt-dlp 2>/dev/null
    chmod +x ./yt-dlp 2>/dev/null
  else
    echo "Disk storage limited (<60MB free), skipping yt-dlp download. Use direct PC video upload."
  fi
fi
chmod +x ./yt-dlp 2>/dev/null

PORT_ARG=""
if [[ "$*" != *"--port"* ]] && [[ "$*" != *"-p"* ]]; then
  PORT_ARG="--port 25697"
fi

exec node --expose-gc --max-old-space-size=128 dashboard/server.js $PORT_ARG "$@"
