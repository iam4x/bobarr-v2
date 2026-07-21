FROM oven/bun:alpine AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install

COPY . .
RUN bun run build

# Production stage
FROM oven/bun:alpine

WORKDIR /app

# Install curl for healthcheck
RUN apk --no-cache add curl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json bun.lock ./

CMD ["bun", "start"]
