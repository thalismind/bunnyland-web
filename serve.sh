#!/usr/bin/env bash
# Launch the Bunnyland snapshot inspector at http://localhost:8080
PORT=${1:-8080}
echo "Bunnyland Inspector → http://localhost:$PORT"
exec python3 -m http.server "$PORT"
