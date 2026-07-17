FROM node:24-bookworm AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-bookworm

ENV BUNNYLAND_API_UPSTREAM=http://server:8765 \
    BUNNYLAND_SERVER_NAME=_ \
    BUNNYLAND_DISCORD_URL= \
    BUNNYLAND_WEB_THEME= \
    BUNNYLAND_WEB_THEMES=[] \
    BUNNYLAND_WEB_REPLACE_THEMES=false

RUN mkdir -p /usr/share/nginx/config

COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
# config.json is rendered from this template at container start (docker-entrypoint.d) so
# per-deployment client settings come from the frontend environment, not a baked file.
COPY docker/config.json.template /usr/share/nginx/config/config.json.template
COPY docker/40-render-web-config.sh /docker-entrypoint.d/40-render-web-config.sh

COPY --from=build /app/dist /usr/share/nginx/html
