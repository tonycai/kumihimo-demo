#!/bin/sh
# Image check: runs INSIDE the built image as root and fails if any env, key or swap file is
# present anywhere on its filesystem. Prints only file names, never contents.
#   usage: sh image-check.sh /app
# Last line on success is exactly "image check: clean"; callers must require it (rule 14).
APP="${1:-/app}"

# Rule 7: prove there is something to check, and that find works at all.
[ -d "$APP" ] || { echo "image check: $APP missing"; exit 2; }
count=$(ls -A "$APP" | wc -l)
[ "$count" -gt 0 ] || { echo "image check: $APP is empty"; exit 2; }
command -v find >/dev/null 2>&1 || { echo "image check: find not available"; exit 2; }

out=/tmp/image-check.$$
# Whole filesystem except kernel trees. find's own failure must not read as "clean" (rule 7).
find / \( -path /proc -o -path /sys -o -path /dev \) -prune -o -type f \
  \( -name '.env*' -o -name '*.pem' -o -name '*.key' -o -name '*.p8' -o -name '*.p12' -o -name '*.sw?' \) \
  -print > "$out" 2>/tmp/image-check.err
status=$?
if [ "$status" -ne 0 ]; then
  echo "image check: find failed ($status)"
  cat /tmp/image-check.err
  exit 2
fi

bad=0
while IFS= read -r f; do
  case "$f" in
    # Rule 6: public CA bundles from the base system are not leaks.
    /etc/ssl/*|/etc/ssl1.1/*|/usr/share/ca-certificates/*|/usr/lib/ssl/*)
      ;;
    # Rule 6: certificate fixtures shipped inside dependencies are listed, not failed.
    */node_modules/*.pem|*/node_modules/*.key|*/node_modules/*.p12)
      echo "note (dependency fixture): $f" ;;
    *)
      echo "FOUND: $f"
      bad=1 ;;
  esac
done < "$out"
rm -f "$out" /tmp/image-check.err

[ "$bad" -eq 0 ] || { echo "image check: FAILED"; exit 1; }
echo "image check: clean"
