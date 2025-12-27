FROM node:20-alpine AS base
WORKDIR /app

# Development stage
FROM base AS development
COPY package*.json ./
COPY turbo.json ./
COPY tsconfig.base.json ./
COPY apps/web/package*.json ./apps/web/
COPY packages/shared-types/package*.json ./packages/shared-types/
COPY packages/config/package*.json ./packages/config/
RUN npm install
COPY . .

# Build stage - Build at runtime to allow env vars
FROM base AS builder
COPY --from=development /app .

# Build args for API URL
ARG API_URL=http://localhost:3010
ENV API_URL=${API_URL}

RUN npm run build --workspace=@mixarr/web

# Production stage
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
