# AI Army - QA Engineer Worker Image
# Base image for QA and test automation workers.
# Includes Playwright with Chromium, Jest, Vitest, and testing tools.

FROM node:22-slim

LABEL org.opencontainers.image.source="https://github.com/developerz-ai/ai-army"
LABEL org.opencontainers.image.description="AI Army - QA Engineer Worker"
LABEL org.opencontainers.image.version="1.0.0"
LABEL ai-army.worker-type="qa-engineer"
LABEL ai-army.tools="bash,git,npm,playwright,readFile,writeFile"

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    python3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Playwright with Chromium browser and system deps
RUN npx playwright install --with-deps chromium

# Install global testing tools
RUN npm install -g \
    @playwright/test@latest \
    jest@latest \
    vitest@latest \
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
