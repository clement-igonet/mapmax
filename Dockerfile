# MapMax — static site image (build & run per project deployment policy).
# The app is buildless (plain ES modules); this image serves the same files
# GitHub Pages serves, so local containers and Pages behave identically.
FROM docker.io/library/nginx:1.27-alpine

COPY index.html styles.css SPECIFICATIONS.md /usr/share/nginx/html/
COPY src/ /usr/share/nginx/html/src/
COPY assets/ /usr/share/nginx/html/assets/

EXPOSE 80
