#!/usr/bin/env bash
# Build and launch the same production output used by the nginx image.
PORT=${1:-8080}
echo "Bunnyland Inspector → http://localhost:$PORT"
npm run build || exit $?
exec python3 -m http.server "$PORT" --directory dist
