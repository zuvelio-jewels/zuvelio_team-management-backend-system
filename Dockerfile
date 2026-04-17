# ── Stage 1: Build ──────────────────────────────────────────────
FROM node:20-slim AS builder

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests + prisma config first (layer caching)
COPY package.json package-lock.json prisma.config.ts tsconfig.json ./
COPY prisma ./prisma

# Install all dependencies (dev included for @nestjs/cli)
RUN npm ci

# Generate Prisma client (inline placeholder — does NOT persist as ENV)
RUN DATABASE_URL="postgresql://p:p@localhost:5432/p" npx prisma generate

# Copy remaining source and build
COPY . .
RUN npx nest build

# ── Stage 2: Production ────────────────────────────────────────
FROM node:20-slim

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests + prisma config (BEFORE prisma generate so config is available)
COPY package.json package-lock.json prisma.config.ts tsconfig.json ./
COPY prisma ./prisma

# Install production dependencies only
RUN npm ci --omit=dev

# Generate Prisma client for the production image
RUN DATABASE_URL="postgresql://p:p@localhost:5432/p" npx prisma generate

# Copy compiled app from builder
COPY --from=builder /app/dist ./dist

# Copy entrypoint
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Railway injects PORT at runtime
CMD ["sh", "./entrypoint.sh"]
