# Electronic Mail as one container: the engine, serving the screens it builds here.
# `docker compose up -d` runs it (compose.yml); tools/ship-pi.sh builds it for a Raspberry Pi.

# The screens, built once on the machine doing the building (they're the same on every platform)
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS screens
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY public/ public/
COPY shared/ shared/
COPY src/ src/
RUN npm run build

# The engine, serving them
FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY engine/package.json engine/package-lock.json engine/
RUN cd engine && npm ci --omit=dev && npm cache clean --force
COPY engine/ engine/
COPY --from=screens /src/dist dist/
# Its data: app.sqlite and secret.key (durable, and only useful together) and cache.sqlite
RUN mkdir -p /data && chown node:node /data
# The engine listens on the container's own network; publish the port, or let a proxy reach it
ENV DATA_DIR=/data STATIC_DIR=/app/dist HOST=0.0.0.0 PORT=3100 MALLOC_ARENA_MAX=2
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://127.0.0.1:3100/api/v2/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "engine/bin/server.ts"]
