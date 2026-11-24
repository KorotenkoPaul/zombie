# Static host for the game on Railway. Serves the game/ folder with Caddy.
FROM caddy:2.8-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY game /srv
# [PERF] every file's mtime comes from its content hash. Caddy's ETag is mtime+size and the build stamped every file
# with the build time, so each deploy (dozens a day) made the phone download all ~20 MB again on its next open; now
# only the files that changed are re-sent (the rest answer 304). Brotli was measured: ~4% under gzip here, not worth it.
# [PERF] binary copies of the base64 models (x-glb.txt -> x.glb, made here so the .txt stays the one source): ~0.7 MB less
# on the wire for the hero and no 5 MB atob on the phone. index.html tries the .glb first and falls back to the .txt.
RUN for f in /srv/*-glb.txt; do base64 -d "$f" > "${f%-glb.txt}.glb" || rm -f "${f%-glb.txt}.glb"; done
RUN find /srv -type f -exec sh -c 'for f; do h=$(md5sum "$f" | cut -c1-7); touch -d "@$((0x$h + 1000000000))" "$f"; done; true' _ {} +
ARG RAILWAY_GIT_COMMIT_SHA=local
RUN echo "$RAILWAY_GIT_COMMIT_SHA" > /srv/version.txt
