#!/usr/bin/env bash
# Feeds scripts/image-check.sh into an image (as root, with -i so the script really runs) and
# requires the completion marker. Shared by the deploy script and the self-test.
#   usage: scripts/run-image-check.sh <image> [log-file]
set -euo pipefail
image="$1"
log="${2:-$(mktemp)}"
here="$(cd "$(dirname "$0")" && pwd)"
docker run -i --rm --user root --entrypoint sh "$image" -s -- /app < "$here/image-check.sh" | tee "$log"
grep -qx "image check: clean" "$log"
