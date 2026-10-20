#!/usr/bin/env bash
# Turns the recording from `KUMIHIMO_DEMO=1 pnpm exec playwright test --project=demo` into docs/demo.gif.
# Real-time playback (no speed-up), so the FPS counter and the demo timers read as recorded.
#   usage: scripts/make-demo-gif.sh [fps] [width]
set -euo pipefail
cd "$(dirname "$0")/.."
fps="${1:-6}"; width="${2:-800}"
video=$(ls -t test-results/demo-*/video.webm | head -n 1)
palette=$(mktemp -t kumihimo-palette).png
trap 'rm -f "$palette"' EXIT
filters="fps=${fps},scale=${width}:-1:flags=lanczos"
ffmpeg -loglevel error -y -i "$video" -vf "${filters},palettegen=stats_mode=diff:max_colors=128" "$palette"
ffmpeg -loglevel error -y -i "$video" -i "$palette" -lavfi "${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" docs/demo.gif
ls -la docs/demo.gif
