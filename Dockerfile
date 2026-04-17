# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Prisma client generation only needs a syntactically valid URL at build time.
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"

# Generate Prisma client and build the application
RUN npm run prisma generate && npm run build

# Stage 2: Runtime
FROM node:20-alpine

WORKDIR /app

# Install dumb-init to handle signals properly and netcat for database checks
RUN apk add --no-cache dumb-init netcat-openbsd

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Copy generated Prisma client assets
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy Prisma schema and migrations
COPY prisma ./prisma

# Copy Prisma runtime config
COPY prisma.config.ts .

# Copy entrypoint script
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/', (r) => {if (r.statusCode >= 400) throw new Error(r.statusCode)})" || exit 1

# Use dumb-init to run the application
ENTRYPOINT ["dumb-init", "--"]
CMD ["./entrypoint.sh"]
