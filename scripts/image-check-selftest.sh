#!/usr/bin/env bash
# Self-test for the image check: small busybox images, nothing pushed or deployed.
# Each case must pass or fail as expected, including "find missing" and "script never ran".
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tag=kumihimo-imagecheck-selftest
fail=0

build() { # name, RUN commands
  printf 'FROM busybox:1.36\nRUN %s\n' "$2" | docker build -q -t "$tag:$1" - >/dev/null
}

expect() { # name, expected (pass|fail)
  local got=pass
  "$here/run-image-check.sh" "$tag:$1" >/dev/null 2>&1 || got=fail
  if [ "$got" = "$2" ]; then echo "ok   $1 → $got"; else echo "BAD  $1 → $got (expected $2)"; fail=1; fi
}

build clean      'mkdir -p /app && echo x > /app/server.js'
build root-env   'mkdir -p /app && echo x > /app/server.js && touch /app/.env.production'
build nested-env 'mkdir -p /app/prisma && echo x > /app/server.js && touch /app/prisma/.env'
build root-key   'mkdir -p /app && echo x > /app/server.js && touch /root/x.key'
build p8         'mkdir -p /app/native && echo x > /app/server.js && touch /app/native/AuthKey_X.p8'
build swap       'mkdir -p /app && echo x > /app/server.js && touch /app/.notes.swp'
build dep-env    'mkdir -p /app/node_modules/pkg && echo x > /app/server.js && touch /app/node_modules/pkg/.env'
build dep-cert   'mkdir -p /app/node_modules/pkg/test && echo x > /app/server.js && touch /app/node_modules/pkg/test/fixture.pem'
build empty-app  'mkdir -p /app'
build no-find    'mkdir -p /app && echo x > /app/server.js && rm /bin/find'

expect clean pass
expect root-env fail
expect nested-env fail
expect root-key fail
expect p8 fail
expect swap fail
expect dep-env fail
expect dep-cert pass
expect empty-app fail
expect no-find fail

# Reverse control: without -i the script never reaches the container; the marker check must catch it.
log=$(mktemp)
if docker run --rm --user root --entrypoint sh "$tag:root-env" -s -- /app < "$here/image-check.sh" > "$log" 2>&1 \
   && ! grep -qx "image check: clean" "$log"; then
  echo "ok   no -i → container exits 0 but prints no marker (the runner would refuse it)"
else
  echo "BAD  no -i control did not behave as expected"; fail=1
fi

docker image rm -f $(docker image ls -q "$tag") >/dev/null 2>&1 || true
[ "$fail" -eq 0 ] && echo "image check selftest: all cases as expected"
exit "$fail"
