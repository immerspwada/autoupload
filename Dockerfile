# ─────────────────────────────────────────────────────────────────
# YouTube Auto Uploader — Production Dockerfile
# Platform: Fly.io (primary) / Railway / any Docker host
# ─────────────────────────────────────────────────────────────────
FROM node:20-slim

# Install system deps: ffmpeg + Thai fonts only
RUN apt-get update && apt-get install -y \
    ffmpeg \
    fonts-thai-tlwg \
    fonts-noto-color-emoji \
    curl \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

WORKDIR /app

# Install dependencies (cached layer)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy source
COPY . .

# ★ Fly.io supports only 1 volume mount.
# We mount it at /app/persist and symlink data/, logs/, downloads/ into it.
# This script runs at container start to set up symlinks.
RUN echo '#!/bin/sh\n\
mkdir -p /app/persist/data /app/persist/logs /app/persist/downloads/tiktok /app/persist/downloads/transformed /app/persist/downloads/temp\n\
rm -rf /app/data /app/logs /app/downloads\n\
ln -sf /app/persist/data /app/data\n\
ln -sf /app/persist/logs /app/logs\n\
ln -sf /app/persist/downloads /app/downloads\n\
exec "$@"' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Create dirs for non-volume mode (local dev / Railway)
RUN mkdir -p data downloads/tiktok downloads/transformed downloads/temp uploads logs assets data/backups

# Non-root user
RUN useradd -r -m -u 1001 appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -sf http://localhost:3000/api/health/live || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "scripts/supervise.js"]
