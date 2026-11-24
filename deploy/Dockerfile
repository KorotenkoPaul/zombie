# Static host for the game on Railway. Serves the game/ folder with Caddy.
FROM caddy:2.8-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY game /srv
# [PERF] every file's mtime comes from its content hash. Caddy's ETag is mtime+size and the build stamped every file
# with the build time, so each deploy (dozens a day) made the phone download all ~20 MB again on its next open; now
# only the files that changed are re-sent (the rest answer 304). Brotli was measured: ~4% under gzip here, not worth it.
RUN find /srv -type f -exec sh -c 'for f; do h=$(md5sum "$f" | cut -c1-7); touch -d "@$((0x$h + 1000000000))" "$f"; done; true' _ {} +
ARG RAILWAY_GIT_COMMIT_SHA=local
RUN echo "$RAILWAY_GIT_COMMIT_SHA" > /srv/version.txt
