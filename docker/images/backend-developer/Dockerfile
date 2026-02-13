# AI Army - Backend Developer Worker Image
# Base image for backend development workers.
# Includes Python 3.11, Django, FastAPI, pytest, and Node.js 22.

FROM python:3.11-slim

LABEL org.opencontainers.image.source="https://github.com/developerz-ai/ai-army"
LABEL org.opencontainers.image.description="AI Army - Backend Developer Worker"
LABEL org.opencontainers.image.version="1.0.0"
LABEL ai-army.worker-type="backend-developer"
LABEL ai-army.tools="bash,git,pip,python,readFile,writeFile"

# hadolint: pipefail needed for curl | bash pattern
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    postgresql-client \
    build-essential \
    ca-certificates \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages
RUN pip3 install --no-cache-dir \
    django \
    fastapi \
    uvicorn \
    sqlalchemy \
    psycopg2-binary \
    pytest \
    black \
    ruff

# Install Node.js 22 (for scripts and tooling)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

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
