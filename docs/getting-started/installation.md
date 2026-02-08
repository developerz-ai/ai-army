# Installation

This guide will help you set up AI Army on your system.

## Prerequisites

Before installing AI Army, ensure you have the following:

### Required

- **Node.js** ≥ 22.0.0
  - Check version: `node --version`
  - Download from [nodejs.org](https://nodejs.org/)

- **Docker** ≥ 20.10 (for bot sandboxing)
  - Check version: `docker --version`
  - Download from [docker.com](https://www.docker.com/get-started)
  - Ensure Docker daemon is running: `docker ps`

- **PostgreSQL** ≥ 14 (for bot state and sessions)
  - Can be run via Docker (recommended for development)
  - Or install locally from [postgresql.org](https://www.postgresql.org/download/)

### Optional

- **Git** (for cloning the repository)
- **npm** or **yarn** (comes with Node.js)

## Installation Methods

### Method 1: NPM Package (Recommended)

Once published, you'll be able to install AI Army as a global package:

```bash
npm install -g ai-army
```

Or as a project dependency:

```bash
npm install ai-army
```

> **Note:** AI Army is currently in development. For now, use Method 2 (from source).

### Method 2: From Source

Clone the repository and install dependencies:

```bash
# Clone the repository
git clone https://github.com/developerz-ai/ai-army.git
cd ai-army

# Install dependencies
npm install

# Make CLI available globally (optional)
npm link
```

## Docker Setup

AI Army uses Docker to run bots in isolated containers. You need to pull the base image:

```bash
# Pull the default Node.js image
docker pull node:22-slim
```

For other languages or custom requirements, you can configure different images in your bot configuration.

## Database Setup

### Option 1: Docker PostgreSQL (Recommended for Development)

Use the provided `docker-compose.yml`:

```bash
# Start PostgreSQL in Docker
docker-compose up -d postgres

# Verify it's running
docker-compose ps
```

The database will be available at `localhost:5432` with these default credentials:
- **Database:** `ai_army`
- **User:** `ai_army`
- **Password:** `ai_army_password`

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

Initialize the database schema:

```bash
npx ai-army migrate
```

This will create all necessary tables for bot state, sessions, audit logs, and message queues.

## Environment Configuration

Create a `.env` file in your project root:

```bash
# AI Provider API Keys
ANTHROPIC_API_KEY=sk-ant-your-key-here
OPENAI_API_KEY=sk-your-openai-key

# Database Connection
DATABASE_URL=postgresql://ai_army:ai_army_password@localhost:5432/ai_army

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
npx ai-army --version

# Validate your configuration
npx ai-army validate

# Check system status
npx ai-army status
```

You should see output confirming:
- ✅ Configuration is valid
- ✅ Database connection works
- ✅ Docker is accessible
- ✅ Required images are available

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

1. Verify PostgreSQL is running: `docker-compose ps` or `pg_isready`
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
- **Disk:** 1 GB free space (plus space for Docker images)

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

> **Note:** On Windows, we strongly recommend using WSL2 for the best Docker integration.

## Uninstalling

To remove AI Army:

```bash
# Remove global installation
npm uninstall -g ai-army

# Or remove project installation
npm uninstall ai-army

# Stop and remove Docker containers
docker-compose down -v

# Remove Docker images (optional)
docker rmi node:22-slim
```

## Getting Help

If you encounter issues:

- 📖 [Read the docs](../)
- 💬 [GitHub Discussions](https://github.com/developerz-ai/ai-army/discussions)
- 🐛 [Report a bug](https://github.com/developerz-ai/ai-army/issues)
- 📧 Contact support
