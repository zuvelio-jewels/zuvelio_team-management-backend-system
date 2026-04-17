# ── Stage 1: Build ──────────────────────────────────────────────
FROM node:20-slim AS builder

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies (layer cache friendly)
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# Copy source and build
COPY . .

# Prisma generate needs a syntactically valid DATABASE_URL at build time
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate
RUN npx nest build

# ── Stage 2: Production ────────────────────────────────────────
FROM node:20-slim AS runner

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only production artifacts
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ts-node is needed at runtime for prisma.config.ts (used by prisma migrate deploy)
RUN npm install ts-node

# Copy Prisma schema + migrations (needed for migrate deploy)
COPY prisma ./prisma

# Re-generate Prisma client in the production image
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate

# Copy compiled app
COPY --from=builder /app/dist ./dist

# Copy entrypoint
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Copy prisma config (needed for migrate deploy)
COPY prisma.config.ts ./prisma.config.ts
COPY tsconfig.json ./tsconfig.json

# Unset the placeholder so it doesn't leak into runtime
ENV DATABASE_URL=""

EXPOSE 8080

CMD ["sh", "./entrypoint.sh"]
