# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies using workspace metadata only to leverage Docker layer caching
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/orchestrator/package.json packages/orchestrator/package.json
COPY packages/telegram-bot/package.json packages/telegram-bot/package.json
RUN npm ci

# Copy source and build the workspace packages
COPY packages ./packages
RUN npm run build --workspaces

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
RUN npm prune --omit=dev

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

FROM runtime AS orchestrator
WORKDIR /app/packages/orchestrator
EXPOSE 3000
CMD ["node", "dist/index.js"]

FROM node:20-bookworm-slim AS telegram-bot
WORKDIR /app
ENV NODE_ENV=production

COPY --from=runtime /app/package.json /app/package-lock.json ./
COPY --from=runtime /app/node_modules ./node_modules
COPY --from=runtime /app/packages ./packages

# Install ffmpeg and whisper.cpp for local transcription
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      ffmpeg git build-essential cmake wget ca-certificates; \
    git clone --depth 1 https://github.com/ggerganov/whisper.cpp /opt/whisper.cpp; \
    make -C /opt/whisper.cpp; \
    wget -O /opt/whisper.cpp/models/ggml-base.en.bin \
      https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin; \
    ln -s /opt/whisper.cpp/main /usr/local/bin/whisper; \
    apt-get purge -y git build-essential cmake wget; \
    apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app/packages/telegram-bot
CMD ["node", "dist/index.js"]
