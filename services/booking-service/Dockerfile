# syntax=docker/dockerfile:1.7
# ---- Stage 1: install production dependencies -------------------------------
# Runs on the build machine's own CPU (BUILDPLATFORM) for speed. The dependencies are
# pure JavaScript, so the same node_modules works on both amd64 and arm64.
FROM --platform=$BUILDPLATFORM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ---- Stage 2: small runtime image -------------------------------------------
FROM node:22-alpine
LABEL org.opencontainers.image.source="https://github.com/SnHr1707/campuspass" \
      org.opencontainers.image.description="CampusPass booking-service"
ENV NODE_ENV=production PORT=3002
WORKDIR /app
# Code stays owned by root and read-only; the app runs as the unprivileged "node" user.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER node
EXPOSE 3002
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3002/health || exit 1
CMD ["node", "src/server.js"]
