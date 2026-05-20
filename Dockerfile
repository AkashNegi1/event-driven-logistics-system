# ─── Install dependencies ─────────────────────────────────────────
FROM node:22-alpine AS deps
LABEL stage=deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ─── Generate Prisma client & build app ──────────────────────────
FROM deps AS build
LABEL stage=build
COPY prisma ./prisma
RUN npx prisma generate && find generated/prisma -name '*.ts' -exec sed -i -e 's|\.ts"|.js"|g' -e "s|\.ts'|.js'|g" {} \;
COPY tsconfig.json tsconfig.build.json nest-cli.json prisma.config.ts ./
COPY src ./src
RUN npm run build

# ─── Seed stage (keeps dev deps like tsx) ────────────────────────
FROM build AS seed
LABEL stage=seed
# Intended for one-shot seed services: docker compose run demo-seed
# All dev dependencies (including tsx) are still available here.

# ─── Prune dev dependencies for lean runtime ─────────────────────
FROM build AS pruned
LABEL stage=pruned
RUN npm prune --omit=dev
CMD ["node", "dist/src/main.js"]

# ─── Runtime stage ──────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

COPY --from=pruned /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/generated ./generated
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./
COPY --from=build /app/package.json ./

# No .env file — all env vars provided at runtime
EXPOSE 3000

CMD ["node", "dist/src/main.js"]
