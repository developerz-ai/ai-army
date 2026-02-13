# AI Army - DevOps Engineer Worker Image
# Base image for DevOps and infrastructure workers.
# Includes Docker CLI, kubectl, Terraform, and common DevOps tools.

FROM alpine:3.19

LABEL org.opencontainers.image.source="https://github.com/developerz-ai/ai-army"
LABEL org.opencontainers.image.description="AI Army - DevOps Engineer Worker"
LABEL org.opencontainers.image.version="1.0.0"
LABEL ai-army.worker-type="devops-engineer"
LABEL ai-army.tools="bash,git,docker,kubectl,terraform,readFile,writeFile"

# Install system tools
RUN apk add --no-cache \
    bash \
    git \
    curl \
    docker-cli \
    python3 \
    py3-pip \
    openssh-client \
    jq \
    yq \
    ca-certificates \
    unzip

# Install kubectl
RUN KUBECTL_VERSION=$(curl -L -s https://dl.k8s.io/release/stable.txt) && \
    curl -LO "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" && \
    install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl && \
    rm kubectl

# Install terraform
ARG TERRAFORM_VERSION=1.7.0
RUN curl -fsSL -o "terraform_${TERRAFORM_VERSION}_linux_amd64.zip" \
    "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip" && \
    unzip "terraform_${TERRAFORM_VERSION}_linux_amd64.zip" && \
    mv terraform /usr/local/bin/ && \
    rm "terraform_${TERRAFORM_VERSION}_linux_amd64.zip"

# Create agent user and workspace
RUN adduser -D -s /bin/bash agent

WORKDIR /home/agent

# Configure git for AI worker
RUN git config --global user.name "AI Worker" && \
    git config --global user.email "worker@ai-army.dev" && \
    git config --global init.defaultBranch main

# Set permissions
RUN chown -R agent:agent /home/agent

USER agent

CMD ["sleep", "infinity"]
