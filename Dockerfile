FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs \
  && mkdir -p /app/uploads \
  && chown -R nextjs:nodejs /app/uploads
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=builder /app/package.json /app/package-lock.json /app/prisma.config.ts ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
USER nextjs
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
