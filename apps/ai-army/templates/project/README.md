# My AI Army Project

An AI worker deployment project powered by [AI Army](https://github.com/developerz-ai/ai-army).

## Prerequisites

- **Node.js** >= 22
- **Docker** installed on each target server
- **SSH access** to your remote servers
- An **LLM API key** (OpenRouter, Anthropic, OpenAI, etc.)

## Quick Start

### 1. Install AI Army

```bash
npm install -g ai-army
```

### 2. Configure Environment

Copy the example environment file and add your credentials:

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

- `OPENROUTER_API_KEY` (or your chosen LLM provider key)
- `VPS_1_HOST` (your server's IP or hostname)

### 3. Configure Servers

Edit `servers.yml` to define your remote servers:

```yaml
servers:
  - id: vps-1
    host: your-server-ip
    ssh:
      user: ubuntu
      keyFile: ~/.ssh/id_rsa
```

### 4. Configure Workers

Edit the worker files in `workers/` or create new ones:

```yaml
id: my-worker
name: My Worker
expertise:
  file: expertise/my-worker.md
repo:
  url: git@github.com:your-org/your-repo.git
  branch: main
```

### 5. Validate and Deploy

```bash
# Validate your configuration
ai-army validate

# Deploy workers to your servers
ai-army deploy
```

## Project Structure

```
.
├── ai-army.yml              # Main project configuration
├── servers.yml              # Server definitions
├── workers/                 # Worker configuration files
│   └── example-worker.yml   # Example worker
├── expertise/               # Worker expertise/personality files
│   └── example.md           # Example expertise
├── .env                     # Environment variables (not committed)
└── .gitignore               # Git ignore rules
```

## Configuration Reference

### `ai-army.yml`

The main configuration file. Defines:

- **LLM provider** and credentials (supports `${ENV_VAR}` syntax)
- **Default settings** applied to all workers (maxSteps, temperature, resources)
- **Worker imports** — list of YAML files in `workers/`
- **Server imports** — reference to `servers.yml`

### `servers.yml`

Defines remote servers where workers will be deployed. Each server needs:

- SSH connection details (host, user, key file)
- Resource limits (max workers, memory, CPUs)
- Labels for worker placement (e.g., `env: production`, `region: us-east`)

### `workers/*.yml`

Each worker file defines:

- Container image and resource requirements
- Expertise file reference (personality/instructions)
- Repository to clone into the workspace
- Tools and MCP servers to provision
- Server selection (by labels or specific server ID)
- Deployment strategy (replicas, health checks)

### `expertise/*.md`

Markdown files that define each worker's personality, skills, and constraints.
These are loaded and injected as the worker's system prompt.

## Adding a New Worker

1. Create `workers/my-worker.yml` (copy from `example-worker.yml`)
2. Create `expertise/my-worker.md` with the worker's personality
3. Add the worker path to `ai-army.yml`:
   ```yaml
   workers:
     - workers/example-worker.yml
     - workers/my-worker.yml
   ```
4. Run `ai-army validate` to check your configuration
5. Run `ai-army deploy` to deploy the worker

## Environment Variables

All string values in YAML files support `${VAR_NAME}` substitution.
Define variables in `.env` and reference them in your configuration:

```yaml
# ai-army.yml
llm:
  apiKey: ${OPENROUTER_API_KEY}
```

```bash
# .env
OPENROUTER_API_KEY=sk-or-v1-...
```

## Learn More

- [AI Army Documentation](https://github.com/developerz-ai/ai-army)
- [Architecture Guide](https://github.com/developerz-ai/ai-army/blob/main/docs/architecture.md)
