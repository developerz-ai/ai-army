# =============================================================================
# AI Army — Production Docker Image
# Multi-stage build for minimal, secure runtime image.
#
# Build:
#   docker build -t ai-army:latest .
#   docker build -t ai-army:1.0.0 --build-arg VERSION=1.0.0 .
#
# Run:
#   docker run -p 3000:3000 --env-file .env ai-army:latest
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1 — Install production dependencies
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps

WORKDIR /app

# Copy only package manifests first for optimal layer caching.
# Changes to source code won't bust the npm ci cache.
COPY package.json package-lock.json ./

RUN npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force

# ---------------------------------------------------------------------------
# Stage 2 — Production runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

# Build-time metadata
ARG VERSION=0.1.0
LABEL org.opencontainers.image.title="ai-army" \
      org.opencontainers.image.description="Multi-bot AI systems framework" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="https://github.com/developerz-ai/ai-army" \
      org.opencontainers.image.licenses="MIT"

# Production hardening
ENV NODE_ENV=production \
    PORT=3000

# Install tini for proper PID 1 signal handling
RUN apk add --no-cache tini

# Create non-root user (security best practice from .env.example checklist)
RUN addgroup -g 1001 -S aiagent && \
    adduser -u 1001 -S aiagent -G aiagent

WORKDIR /app

# Copy production dependencies from deps stage
COPY --from=deps --chown=aiagent:aiagent /app/node_modules ./node_modules

# Copy application source
COPY --chown=aiagent:aiagent package.json ./
COPY --chown=aiagent:aiagent src/ ./src/
COPY --chown=aiagent:aiagent bin/ ./bin/
COPY --chown=aiagent:aiagent migrations/ ./migrations/
COPY --chown=aiagent:aiagent templates/ ./templates/
COPY --chown=aiagent:aiagent skills/ ./skills/

# Bots directory — typically mounted at runtime, but copy defaults
COPY --chown=aiagent:aiagent bots/ ./bots/
COPY --chown=aiagent:aiagent config.json ./

# Create data directory for runtime state (volume mount point)
RUN mkdir -p /app/data && chown aiagent:aiagent /app/data

# Drop to non-root user
USER aiagent

# Expose the default HTTP port
EXPOSE 3000

# Health check — lightweight TCP probe on the app port
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "const http = require('http'); const req = http.request({port: ${PORT}, timeout: 2000}, res => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => process.exit(1)); req.end();"

# Use tini as init process for proper signal forwarding and zombie reaping
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application
CMD ["node", "src/index.js"]
