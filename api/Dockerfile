# MapMax world-band API (#154): headless Chromium rendering the app's own
# street scene. Same playwright base as the e2e image, so behavior matches CI.
FROM mcr.microsoft.com/playwright:v1.47.2-jammy

WORKDIR /app
RUN npm init -y >/dev/null && npm install --no-audit --no-fund playwright@1.47.2

# The renderer serves the app's own modules to itself — only what it imports.
COPY vendor/ /app/vendor/
COPY src/ /app/src/
COPY api/ /app/api/

ENV PORT=8080 SITE_ROOT=/app CACHE_DIR=/var/cache/worldband
CMD ["node", "api/server.mjs"]
