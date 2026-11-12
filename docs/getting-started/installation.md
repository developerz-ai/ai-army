# Installation

This guide will help you set up AI Army on your system.

## Prerequisites

Before installing AI Army, ensure you have the following:

### Required

- **Node.js** ≥ 22.0.0
  - Check version: `node --version`
  - Download from [nodejs.org](https://nodejs.org/)

- **PostgreSQL** 18 (for bot state and sessions)
  - The bundled `docker-compose.yml` runs `postgres:18-alpine` (recommended for development)
  - Or install locally from [postgresql.org](https://www.postgresql.org/download/)

- **Docker Compose** (for the PostgreSQL service only — bots are not Docker-sandboxed)
  - Check version: `docker compose version`
  - Download from [docker.com](https://www.docker.com/get-started)

- **Incus** (bot sandboxing — bots run in Incus containers, not Docker)
  - Check version: `incus --version`
  - See [Incus bots](incus-bots.md) for images, profiles, and resource limits

- **Git** (to clone this repository — AI Army is installed from source)
  - Check version: `git --version`

### API Keys

Set only the keys your setup needs, in `.env` or your environment:

- `OPENROUTER_API_KEY` — default provider for `openrouter/...` models
- `ANTHROPIC_API_KEY` — Anthropic models
- `OPENAI_API_KEY` — OpenAI models
- `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET` — when a Slack channel is configured
- `DISCORD_BOT_TOKEN` — when a Discord channel is configured

## Installation

AI Army is installed **from source** — there is no npm package.

```bash
# Clone the repository
git clone https://github.com/developerz-ai/ai-army.git
cd ai-army

# Install dependencies
npm install

# Create your configuration
cp config.example.json config.json
```

`config.example.json` passes `node bin/cli.js validate` out of the box: every `${VAR}` reference carries a `${VAR:-default}` fallback, so validation succeeds even with no environment variables set. Edit the copy to match your setup, or leave it and set the environment variables it references.

## Sandbox Setup

Bots run in isolated **Incus** containers, not Docker — Docker Compose is only used for the PostgreSQL service. The default Incus image is `images:ubuntu/24.04/cloud`; per-bot images, memory and CPU limits are configured in each bot's `config.json`:

```json
{
  "sandbox": {
    "type": "incus",
    "incusImage": "images:ubuntu/24.04/cloud",
    "memory": "2g",
    "cpus": 2
  }
}
```

See [Incus bots](incus-bots.md) for setup and the full sandbox reference.

## Database Setup

### Option 1: Docker PostgreSQL (Recommended for Development)

Use the provided `docker-compose.yml` (it runs `postgres:18-alpine`; `bin/setup` does this for you):

```bash
# Start PostgreSQL in Docker (Compose V2)
docker compose up -d --wait postgres

# Verify it's running
docker compose ps
```

The database will be available at `localhost:5432` with these default credentials:
- **Database:** `ai_army`
- **User:** `ai_army`
- **Password:** `ai_army_dev`

### Option 2: Local PostgreSQL Installation

1. Install PostgreSQL on your system
2. Create a database and user:

```sql
CREATE DATABASE ai_army;
CREATE USER ai_army WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE ai_army TO ai_army;
```

3. Configure the connection in `.env`:

```bash
DATABASE_URL=postgresql://ai_army:your_password@localhost:5432/ai_army
```

### Run Migrations

The CLI takes the database connection from the environment — it loads a repo-root `.env` automatically, and exported variables win. Option 2 writes `DATABASE_URL` to `.env` above; Option 1 sets nothing, so export it (matching the Compose credentials) before migrating:

```bash
export DATABASE_URL=postgresql://ai_army:ai_army_dev@localhost:5432/ai_army

# Initialize the database schema
node bin/cli.js migrate
```

This will create all necessary tables for bot state, sessions, audit logs, and message queues.

## Environment Configuration

The CLI loads environment variables from a `.env` file in the repo root (exported variables take precedence). Create one and add the keys your setup needs:

```bash
# AI Provider API Keys
OPENROUTER_API_KEY=sk-or-your-key-here
ANTHROPIC_API_KEY=sk-ant-your-key-here
OPENAI_API_KEY=sk-your-openai-key

# Database Connection (config.example.json defaults to this URL)
DATABASE_URL=postgresql://ai_army:ai_army_dev@localhost:5432/ai_army

# Channels (only when configured)
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_APP_TOKEN=xapp-your-token-here
SLACK_SIGNING_SECRET=your-signing-secret
DISCORD_BOT_TOKEN=your-discord-token

# API Server (optional)
API_PORT=3000
API_TOKEN=your-secure-token-here

# Logging (optional)
LOG_LEVEL=info
```

> **Security:** Never commit your `.env` file to version control. It's already in `.gitignore`.

## Verify Installation

Check that everything is working:

```bash
# Verify the CLI is available
node bin/cli.js --version

# Validate your configuration (works with no environment set — the example
# config carries a ${VAR:-default} fallback for every reference)
node bin/cli.js validate

# Check system status (needs DATABASE_URL, e.g. from .env)
node bin/cli.js status
```

You should see:
- `validate` print `🔍 Validating configuration...` followed by `✅ All configurations valid`
- `status` print its report with `✅ Connected to PostgreSQL …` under `Database:` (with `DATABASE_URL` set — otherwise it exits non-zero with `❌ DATABASE_URL environment variable is required`)

`validate` and `status` check the configuration and the database only — Incus is exercised when a bot starts in its sandbox, not here. Confirm it separately with `incus --version` and the [Incus bots](incus-bots.md) guide.

## Next Steps

Now that AI Army is installed, you can:

1. [Create your first bot](first-bot.md) - Step-by-step tutorial
2. [Configure your bots](configuration.md) - Learn about bot configuration options
3. [Deploy to production](../deployment.md) - Production deployment guide

## Troubleshooting

### Docker Permission Errors

If you get permission errors with Docker:

```bash
# Add your user to the docker group (Linux)
sudo usermod -aG docker $USER
newgrp docker
```

### Node Version Issues

If you have an older Node.js version:

```bash
# Use nvm to install Node 22
nvm install 22
nvm use 22
```

### Database Connection Errors

If migrations fail:

1. Verify PostgreSQL is running: `docker compose ps` or `pg_isready`
2. Check your `DATABASE_URL` in `.env`
3. Ensure the database exists: `psql -U ai_army -d ai_army -c '\dt'`

### Port Already in Use

If port 3000 (API) or 5432 (PostgreSQL) is already in use:

1. Change the port in `.env` or `docker-compose.yml`
2. Or stop the conflicting service

## System Requirements

### Minimum

- **CPU:** 2 cores
- **RAM:** 2 GB available
- **Disk:** 1 GB free space (plus space for container images)

### Recommended

- **CPU:** 4+ cores
- **RAM:** 4+ GB available
- **Disk:** 10+ GB free space
- **Network:** Stable internet connection for AI API calls

## Supported Platforms

AI Army has been tested on:

- ✅ **Linux** (Ubuntu 20.04+, Debian 11+)
- ✅ **macOS** (12.0+)
- ✅ **Windows** (WSL2 recommended)

> **Note:** On Windows, we strongly recommend using WSL2 for the best Docker Compose (PostgreSQL) and Incus experience.

## Uninstalling

AI Army lives entirely in the directory you cloned, so removal is simple:

```bash
# Stop and remove the PostgreSQL container (from the repo root)
docker compose down -v

# Remove the checkout
cd ..
rm -rf ai-army
```

Any leftover bot sandboxes are Incus containers — find and remove them with `incus list` / `incus delete <name>`.

## Getting Help

If you encounter issues:

- 📖 [Read the docs](../)
- 💬 [GitHub Discussions](https://github.com/developerz-ai/ai-army/discussions)
- 🐛 [Report a bug](https://github.com/developerz-ai/ai-army/issues)
- 📧 Contact support
