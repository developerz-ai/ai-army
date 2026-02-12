# AI Army - Frontend Developer Worker Image
# Base image for frontend development workers.
# Includes Node.js 22, TypeScript, Vite, ESLint, Prettier, and Playwright.

FROM node:22-slim

LABEL org.opencontainers.image.source="https://github.com/developerz-ai/ai-army"
LABEL org.opencontainers.image.description="AI Army - Frontend Developer Worker"
LABEL org.opencontainers.image.version="1.0.0"
LABEL ai-army.worker-type="frontend-developer"
LABEL ai-army.tools="bash,git,npm,readFile,writeFile"

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    python3 \
    python3-pip \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install global npm packages
RUN npm install -g \
    typescript@latest \
    vite@latest \
    eslint@latest \
    prettier@latest \
    @playwright/test@latest \
    && npm cache clean --force

# Create agent user and workspace
RUN useradd -m -s /bin/bash agent

WORKDIR /home/agent

# Configure git for AI worker
RUN git config --global user.name "AI Worker" && \
    git config --global user.email "worker@ai-army.dev" && \
    git config --global init.defaultBranch main

# Set permissions
RUN chown -R agent:agent /home/agent

USER agent

CMD ["sleep", "infinity"]
