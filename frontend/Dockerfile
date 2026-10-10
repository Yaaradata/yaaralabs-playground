# Production Dockerfile for Next.js Frontend
FROM node:20-alpine AS base

# Accept build arguments
ARG NODE_ENV=production
ARG NEXT_TELEMETRY_DISABLED=1

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package*.json ./
# Install ALL dependencies (including dev dependencies) needed for build
RUN npm ci --silent

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set production environment from build args
ENV NODE_ENV=${NODE_ENV}
ENV NEXT_TELEMETRY_DISABLED=${NEXT_TELEMETRY_DISABLED}

# Build the application with all routes
RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json

# Copy the entire .next directory (not standalone)
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Use npm start instead of standalone server
CMD ["npm", "start"]
