# Containerized Chromium for end-to-end tests (project test policy).
FROM mcr.microsoft.com/playwright:v1.47.2-jammy

WORKDIR /work
RUN npm init -y >/dev/null && npm install --no-audit --no-fund playwright@1.47.2

COPY *.mjs ./
CMD ["node", "streetview.e2e.mjs"]
