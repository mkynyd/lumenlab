FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    fonts-noto-cjk \
    texlive-full \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 compiler \
  && useradd --system --uid 1001 --gid compiler compiler

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
COPY src ./src
COPY services/paper-compiler ./services/paper-compiler

RUN npx prisma generate \
  && mkdir -p /app/uploads /app/tmp \
  && chown -R compiler:compiler /app

USER compiler
ENV NODE_ENV=production
ENV PAPER_COMPILE_SERVICE_MODE=true
ENV PAPER_COMPILE_WORKER_ENABLED=false

CMD ["npm", "run", "paper:compiler"]
