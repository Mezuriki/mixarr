FROM node:20-alpine AS base
WORKDIR /app
# Install OpenSSL for Prisma in all stages
RUN apk add --no-cache openssl openssl-dev

# Development stage
FROM base AS development
COPY package*.json ./
COPY turbo.json ./
COPY tsconfig.base.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages/shared-types/package*.json ./packages/shared-types/
COPY packages/config/package*.json ./packages/config/
RUN npm install
COPY . .
# Generate Prisma client AFTER copying all files (including updated schema)
WORKDIR /app/apps/api
RUN npx prisma generate
WORKDIR /app

# Build stage
FROM base AS builder
COPY --from=development /app .
RUN npm run build --workspace=@mixarr/api

# Production stage
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package*.json ./
COPY --from=builder /app/apps/api/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules

# Generate Prisma client in production
RUN npx prisma generate

EXPOSE 3010
CMD ["node", "dist/index.js"]

