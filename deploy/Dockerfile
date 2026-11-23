# Static host for the game on Railway. Serves the game/ folder with Caddy.
FROM caddy:2.8-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY game /srv
ARG RAILWAY_GIT_COMMIT_SHA=local
RUN echo "$RAILWAY_GIT_COMMIT_SHA" > /srv/version.txt
