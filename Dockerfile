FROM nginx:1.27-alpine

ENV BUNNYLAND_API_UPSTREAM=http://server:8765 \
    BUNNYLAND_SERVER_NAME=_ \
    BUNNYLAND_DISCORD_URL=

RUN mkdir -p /usr/share/nginx/config

COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
# config.json is rendered from this template at container start (docker-entrypoint.d) so
# per-deployment client settings come from the frontend environment, not a baked file.
COPY docker/config.json.template /usr/share/nginx/config/config.json.template
COPY docker/40-render-web-config.sh /docker-entrypoint.d/40-render-web-config.sh

COPY *.html favicon.png LICENSE README.md /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets
COPY examples /usr/share/nginx/html/examples
