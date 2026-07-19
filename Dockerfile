# ─────────────────────────────────────────────────────────────────
# YouTube Auto Uploader — Production Dockerfile
# Platform: Railway / Fly.io / Render / VPS (any Docker host)
# ─────────────────────────────────────────────────────────────────
FROM node:20-slim

# Install system deps for puppeteer + chromium + yt-dlp
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    python3 \
    python3-pip \
    curl \
    ca-certificates \
    --no-install-recommends \
    && pip3 install --break-system-packages yt-dlp \
    && rm -rf /var/lib/apt/lists/*

# Tell puppeteer to use system chromium instead of downloading its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

# Install dependencies (cached layer)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# Create persistent directories (will be mounted as volumes)
RUN mkdir -p data downloads/tiktok uploads logs .uploads

# Non-root user for security
RUN useradd -r -m -u 1001 appuser \
    && chown -R appuser:appuser /app
USER appuser

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', r => process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
