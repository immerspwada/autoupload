# ─────────────────────────────────────────────────────────────────
# YouTube Auto Uploader — Production Dockerfile
# Platform: Fly.io (primary) / Railway / Render / VPS
#
# ★ puppeteer/chromium ถูกถอดออก — ไม่มีโค้ดไหนเรียก puppeteer
#   ลดขนาด image ~300MB + ลด memory footprint
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

# Create persistent directories (will be mounted as Fly.io volumes)
RUN mkdir -p data downloads/tiktok downloads/transformed downloads/temp uploads logs assets data/backups

# Non-root user for security
RUN useradd -r -m -u 1001 appuser \
    && chown -R appuser:appuser /app
USER appuser

# Expose port
EXPOSE 3000

# Health check (for Docker standalone; Fly.io uses fly.toml checks)
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -sf http://localhost:3000/api/health/live || exit 1

# ★ Use supervisor for auto-restart on crash
CMD ["node", "scripts/supervise.js"]
