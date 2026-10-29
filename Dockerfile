# ShareSpace production image: one container serves the API and the built web app from the same
# origin, so session cookies stay first-party. Pending database migrations run on start.

FROM node:24-bookworm-slim AS base
# Prisma's query engine needs OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Manifests only, so dependency layers are cached until a package.json or the lockfile changes.
FROM base AS manifests
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

# Build: type-check everything and produce the static web bundle.
FROM manifests AS build
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN npm run build

# Runtime dependencies for the server and the shared core package only.
FROM manifests AS deps
RUN npm ci --omit=dev --no-audit --no-fund --workspace @sharespace/server --workspace @sharespace/core
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/server apps/server
RUN npx prisma generate --schema apps/server/prisma/schema.prisma

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    WEB_DIST=/app/apps/web/dist \
    STORAGE_DIR=/data/storage \
    PATH=/app/node_modules/.bin:$PATH
COPY --from=deps --chown=node:node /app /app
COPY --from=build --chown=node:node /app/apps/web/dist /app/apps/web/dist
RUN mkdir -p /data/storage && chown -R node:node /data
USER node
WORKDIR /app/apps/server
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# exec makes Node PID 1 so it receives SIGTERM and shuts down cleanly.
CMD ["sh", "-c", "prisma migrate deploy && exec node --import tsx src/index.ts"]
