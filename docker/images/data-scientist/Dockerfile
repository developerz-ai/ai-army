# AI Army - Data Scientist Worker Image
# Base image for data science and machine learning workers.
# Includes Python 3.11, pandas, numpy, scikit-learn, matplotlib, and Jupyter.
# NOTE: Uses python:3.11-slim (not jupyter/scipy-notebook) to keep image <1GB.
# Heavy ML frameworks (tensorflow, torch) are left for user customization.

FROM python:3.11-slim

LABEL org.opencontainers.image.source="https://github.com/developerz-ai/ai-army"
LABEL org.opencontainers.image.description="AI Army - Data Scientist Worker"
LABEL org.opencontainers.image.version="1.0.0"
LABEL ai-army.worker-type="data-scientist"
LABEL ai-army.tools="bash,git,python,pip,jupyter,readFile,writeFile"

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install core data science packages
RUN pip3 install --no-cache-dir \
    pandas \
    numpy \
    scikit-learn \
    matplotlib \
    seaborn \
    plotly \
    jupyterlab \
    notebook \
    scipy \
    statsmodels

# Create agent user, workspace, and configure git
RUN useradd -m -s /bin/bash agent && \
    git config --global user.name "AI Worker" && \
    git config --global user.email "worker@ai-army.dev" && \
    git config --global init.defaultBranch main

WORKDIR /home/agent

RUN chown -R agent:agent /home/agent

USER agent

CMD ["sleep", "infinity"]
