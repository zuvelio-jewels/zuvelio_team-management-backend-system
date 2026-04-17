FROM node:20-slim

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy everything
COPY . .

# Install all dependencies (including dev — needed for nest build + prisma config)
RUN npm ci

# Generate Prisma client (inline placeholder avoids polluting ENV)
RUN DATABASE_URL="postgresql://p:p@localhost:5432/p" npx prisma generate

# Build NestJS
RUN npx nest build

# Prune dev dependencies after build
RUN npm prune --omit=dev

# Re-generate Prisma client against prod node_modules
RUN DATABASE_URL="postgresql://p:p@localhost:5432/p" npx prisma generate

RUN chmod +x ./entrypoint.sh

EXPOSE 3000

CMD ["sh", "./entrypoint.sh"]
