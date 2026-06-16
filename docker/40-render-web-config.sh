#!/bin/sh
# Render the client config.json from the frontend environment at container start.
#
# config.json is the single per-deployment settings channel every browser client fetches
# (serverUrl, autoConnect, discordUrl, ...). Keeping it a rendered template means an admin
# can change a deployment value by setting an env var and restarting the frontend, with no
# image rebuild. Only the listed variables are substituted, so any other ${...} that might
# appear in a future template is left untouched rather than blanked.
set -eu

template=/usr/share/nginx/config/config.json.template
output=/usr/share/nginx/config/config.json

if [ -f "$template" ]; then
  envsubst '${BUNNYLAND_DISCORD_URL}' < "$template" > "$output"
fi
