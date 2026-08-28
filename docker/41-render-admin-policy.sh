#!/bin/sh
# Keep browser-facing admin APIs closed unless a deployment explicitly enables them.
set -eu

enabled=${BUNNYLAND_EDGE_ADMIN_ENABLED:-false}
output=${BUNNYLAND_EDGE_ADMIN_POLICY_PATH:-/tmp/bunnyland-admin-policy.conf}

case "$enabled" in
  true)
    : > "$output"
    ;;
  false)
    printf '%s\n' 'return 403;' > "$output"
    ;;
  *)
    printf '%s\n' 'BUNNYLAND_EDGE_ADMIN_ENABLED must be true or false' >&2
    exit 1
    ;;
esac
