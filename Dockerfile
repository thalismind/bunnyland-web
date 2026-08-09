FROM node:24-bookworm@sha256:5711a0d445a1af54af9589066c646df387d1831a608226f4cd694fc59e745059 AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
RUN npm audit --audit-level=high

COPY . .
RUN npm run build

FROM nginx:1.30.4-trixie@sha256:5cf90903deda2c5981b8ad05e7617ac010e389f0dde0ac83487c02c509281de6

ENV BUNNYLAND_API_UPSTREAM=http://server:8765 \
    BUNNYLAND_SERVER_NAME=_ \
    BUNNYLAND_EDGE_API_RATE=30r/s \
    BUNNYLAND_EDGE_API_BURST=60 \
    BUNNYLAND_EDGE_API_CONNECTIONS=24 \
    BUNNYLAND_EDGE_MAX_BODY_SIZE=12m \
    BUNNYLAND_DISCORD_URL= \
    BUNNYLAND_3D_URL= \
    BUNNYLAND_WEB_THEME= \
    BUNNYLAND_WEB_THEMES=[] \
    BUNNYLAND_WEB_REPLACE_THEMES=false \
    NGINX_ENVSUBST_FILTER=^BUNNYLAND_

RUN apt-get update \
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/* \
    && chown -R 101:101 /etc/nginx/conf.d /var/cache/nginx /var/run

COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
# config.json is rendered from this template at container start (docker-entrypoint.d) so
# per-deployment client settings come from the frontend environment, not a baked file.
COPY docker/config.json.template /usr/share/nginx/bunnyland-config.json.template
COPY docker/40-render-web-config.sh /docker-entrypoint.d/40-render-web-config.sh

COPY --from=build /app/dist /usr/share/nginx/html

USER 101:101
