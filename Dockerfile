FROM nginx:1.27-alpine

ENV BUNNYLAND_API_UPSTREAM=http://server:8765 \
    BUNNYLAND_SERVER_NAME=_

RUN mkdir -p /usr/share/nginx/config

COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker/config.json /usr/share/nginx/config/config.json

COPY *.html favicon.png LICENSE README.md /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets
COPY examples /usr/share/nginx/html/examples
