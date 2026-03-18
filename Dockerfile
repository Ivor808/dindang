# Build stage
FROM node:22-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

ENV DINDANG_MODE=local

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
ARG DINDANG_VERSION=dev
ENV DINDANG_VERSION=$DINDANG_VERSION
RUN npm run build

# Prune devDeps, reinstall runtime tools
RUN npm prune --omit=dev && npm install drizzle-kit tsx

# Runtime stage
FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
