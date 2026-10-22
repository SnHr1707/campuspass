# syntax=docker/dockerfile:1.7
# ---- Stage 1: build the React app -------------------------------------------
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
ARG BUILD_SHA=local
ENV VITE_BUILD_SHA=$BUILD_SHA
RUN npm run build

# ---- Stage 2: serve static files with unprivileged NGINX --------------------
FROM nginxinc/nginx-unprivileged:1.31-alpine
LABEL org.opencontainers.image.source="https://github.com/SnHr1707/campuspass" \
      org.opencontainers.image.description="CampusPass frontend"
ENV GATEWAY_UPSTREAM=api-gateway:8080
# Apply OS security patches released after the base image was published.
USER root
RUN apk upgrade --no-cache
USER 101
COPY nginx.conf /etc/nginx/nginx.conf
COPY default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
# nginx-unprivileged already defaults to this user; stating it makes the intent explicit.
USER 101
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1
