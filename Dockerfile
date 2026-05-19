# ─── Build stage ────────────────────────────────────────────────
FROM node:22-alpine AS builder
LABEL stage=builder
WORKDIR /app

# Install dependencies (includes dev dependencies for build)
COPY package.json package-lock.json ./
RUN npm ci

# Generate Prisma client and fix .ts→.js extension imports
# Prisma 7.8.0 generates .ts files with .ts import extensions;
# Node cannot resolve .ts imports at runtime.
COPY prisma ./prisma
RUN npx prisma generate && find generated/prisma -name '*.ts' -exec sed -i -e 's|\.ts"|.js"|g' -e "s|\.ts'|.js'|g" {} \;

# Build the NestJS application
COPY tsconfig.json tsconfig.build.json nest-cli.json prisma.config.ts ./
COPY src ./src
RUN npm run build

# Prune dev dependencies for smaller runtime
RUN npm prune --omit=dev

# ─── Runtime stage ──────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# Copy production artifacts from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/package.json ./

# No .env file — all env vars provided at runtime
EXPOSE 3000

CMD ["node", "dist/src/main.js"]
