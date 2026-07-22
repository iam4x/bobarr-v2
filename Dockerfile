FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS dependencies

WORKDIR /app
COPY package.json bun.lock ./
RUN HUSKY=0 bun install --frozen-lockfile

FROM dependencies AS builder

COPY . .
RUN bun run build

FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    BOBARR_CONFIG_DIR=/config \
    BOBARR_MEDIA_DIR=/media \
    PORT=3000

COPY --from=builder --chown=bun:bun /app/dist ./dist
COPY --from=builder --chown=bun:bun /app/package.json ./package.json
COPY --from=builder --chown=bun:bun /app/scripts/reset-admin.ts ./scripts/reset-admin.ts

USER bun
EXPOSE 3000
VOLUME ["/config", "/media"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health/ready >/dev/null || exit 1

CMD ["bun", "--cwd", "dist", "index.js"]
