# ── Stage 1: Build React ────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 2: Production ─────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY --from=builder /app/dist ./dist

ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "require('http').get('http://localhost:3000/api/health', r => r.statusCode===200 ? process.exit(0) : process.exit(1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
