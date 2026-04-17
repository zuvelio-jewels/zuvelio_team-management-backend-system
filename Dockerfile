FROM node:20-slim

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy everything
COPY . .

# Force LF line endings on shell scripts (safety for Windows dev machines)
RUN sed -i 's/\r$//' entrypoint.sh && chmod +x entrypoint.sh

# Install all dependencies
RUN npm ci

# Generate Prisma client
RUN DATABASE_URL="postgresql://p:p@localhost:5432/p" npx prisma generate

# Build NestJS
RUN npx nest build

# Tell Railway which port to proxy to
EXPOSE 8080

CMD ["node", "dist/src/main.js"]
