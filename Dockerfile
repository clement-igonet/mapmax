# MapMax — static site image (build & run per project deployment policy).
# The app is buildless (plain ES modules); this image serves the same files
# GitHub Pages serves, so local containers and Pages behave identically.
FROM docker.io/library/nginx:1.27-alpine

COPY index.html styles.css SPECIFICATIONS.md /usr/share/nginx/html/
COPY src/ /usr/share/nginx/html/src/
COPY assets/ /usr/share/nginx/html/assets/
COPY vendor/ /usr/share/nginx/html/vendor/
COPY docker/default.conf /etc/nginx/conf.d/default.conf

# Bake the deployment env into env.js so feature gating is deployment-driven, not
# URL-driven (#95 stack split). `web` builds the default (prod); `web-staging`
# passes MAPMAX_ENV=staging; the sandbox image sets sandbox.
ARG MAPMAX_ENV=prod
RUN printf "export const MAPMAX_ENV = '%s';\n" "$MAPMAX_ENV" > /usr/share/nginx/html/src/env.js

EXPOSE 80
