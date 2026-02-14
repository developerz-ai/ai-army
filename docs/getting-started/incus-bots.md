# Using Incus Containers with AI Army

This guide explains how to configure and use Incus (LXC) containers for your AI Army bots.

## Why Incus?

Incus provides **system-level containers** (closer to lightweight VMs) with benefits over Docker:

- **Stronger isolation** - Full OS-level namespace isolation via unprivileged user namespaces
- **Lower overhead** - Containers start faster (<200ms) and use less memory
- **System access** - Install packages, run services, use systemd
- **Docker support** - Run Docker inside Incus containers when needed
- **Persistence** - Full filesystem persistence without volume management
- **OVH VPS friendly** - Incus runs well on Ubuntu 24.04 VPS instances

## Quick Start

### 1. Configure an Incus Bot

Create a bot with Incus instead of Docker:

```bash
mkdir -p bots/code-bot
```

Create `bots/code-bot/config.json`:

```json
{
  "id": "code-bot",
  "soul": "./soul.md",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "tools": [
    "bash",
    "readFile",
    "writeFile"
  ],
  "sandbox": {
    "type": "incus",
    "incusImage": "images:ubuntu/24.04/cloud",
    "memory": "2g",
    "cpus": 2
  }
}
```

Create `bots/code-bot/soul.md`:

```markdown
# Code Bot

You are a helpful coding assistant that works in an Incus container environment.

## Capabilities

- Write and debug code
- Execute bash commands
- Install packages via apt-get
- Work with any development tools

## Sandbox

You run in a full Ubuntu 24.04 Linux container with unrestricted system access.
```

### 2. Validate and Run

```bash
npx ai-army validate
npx ai-army start
```

Your Incus bot is now ready!

## Image Selection

Choose the right Incus image for your bot's needs:

### Ubuntu (Default)

Most flexible, includes systemd and common tools:

```json
{
  "sandbox": {
    "type": "incus",
    "incusImage": "images:ubuntu/24.04/cloud"
  }
}
```

**Good for:** General-purpose bots, development tools, full Linux environments

### Alpine

Very lightweight, minimal footprint:

```json
{
  "sandbox": {
    "type": "incus",
    "incusImage": "images:alpine/3.20"
  }
}
```

**Good for:** Lightweight bots, minimal resource requirements, CI/CD tools

### Debian

Stable, good package ecosystem:

```json
{
  "sandbox": {
    "type": "incus",
    "incusImage": "images:debian/bookworm"
  }
}
```

**Good for:** Bot needing stable, tested packages

## Resource Configuration

Size containers based on what the bot needs to do:

### Light Workloads

- Single language bot, no dependencies:

```json
{
  "sandbox": {
    "type": "incus",
    "memory": "512m",
    "cpus": 1
  }
}
```

### Medium Workloads

- Development tools, running a database:

```json
{
  "sandbox": {
    "type": "incus",
    "memory": "2g",
    "cpus": 2
  }
}
```

### Heavy Workloads

- Full stack projects, Docker Compose, multiple services:

```json
{
  "sandbox": {
    "type": "incus",
    "memory": "4g",
    "cpus": 4,
    "dockerAccess": true
  }
}
```

## Docker Inside Incus

When your bot needs to work with Docker-based projects:

```json
{
  "sandbox": {
    "type": "incus",
    "incusImage": "images:ubuntu/24.04/cloud",
    "memory": "4g",
    "cpus": 4,
    "dockerAccess": true
  }
}
```

With `dockerAccess: true`:

- Docker daemon runs inside the Incus container
- Bot can run `docker build`, `docker run`, `docker compose`
- Each bot has isolated Docker images and containers
- Full resource isolation - Docker usage counts against Incus container limits

### Example: Project Setup Bot with Docker Compose

Bot that clones repos and runs their docker-compose:

```bash
# Inside the bot's sandbox:
$ git clone https://github.com/user/project.git
$ cd project
$ docker compose up -d
$ docker compose logs api
```

This works because `dockerAccess: true` provides Docker inside the Incus container.

## Lifecycle

Your Incus bot container persists across restarts:

1. **Container Created** - Incus launches from base image
2. **Bot Starts** - AI Army starts managing the container
3. **Workspace Preserved** - `/home/agent` persists between sessions
4. **Container Stopped** - On shutdown, container can be snapshotted
5. **Container Restarted** - State restored, bot resumes

No need to rebuild or reconfigure - the entire filesystem state persists.

## Comparing Docker vs Incus

| Feature | Docker | Incus |
|---------|--------|-------|
| Process isolation | Single process | Full OS |
| Startup time | ~1-2s | <200ms |
| Memory overhead | ~100-200MB | ~50-100MB |
| System access | Limited | Full (with restrictions) |
| Package management | Image-based | Live (apt-get, apk, etc.) |
| Service management | Manual | systemd support |
| Docker support | Process-limited | Full nesting |
| Network | Port mapping | Full bridge networking |

## Migration from Docker

Convert an existing Docker bot to Incus:

**Old Docker config:**

```json
{
  "sandbox": {
    "type": "docker",
    "image": "node:22-slim",
    "memory": "1g",
    "cpus": 2
  }
}
```

**New Incus config:**

```json
{
  "sandbox": {
    "type": "incus",
    "incusImage": "images:ubuntu/24.04/cloud",
    "memory": "1g",
    "cpus": 2
  }
}
```

The configuration change will trigger a container replacement on next deployment.

## Troubleshooting

### Container fails to start

- **Check Incus is installed**: `incus version`
- **Check permissions**: `incus list` should show containers
- **Check image exists**: `incus image list | grep ubuntu`
- **Check logs**: `npx ai-army logs bot-id`

### Out of memory

- Bot sandbox hit memory limit
- Increase `memory` in sandbox config
- Check what's running: `top` inside the container
- Consider splitting workload across multiple bots

### Incus not available

- If Incus isn't installed, use `type: "docker"` instead
- Install Incus: `apt install incus`
- Or use `type: "just-bash"` for local development

## Advanced Configuration

### Custom Profiles

Use Incus profiles for complex setups:

```json
{
  "sandbox": {
    "type": "incus",
    "incusProfile": "custom-profile"
  }
}
```

Profiles can configure:
- Device limits (disk, network)
- Additional devices (USB, GPU)
- Security policies
- Mount points

Create profiles once on your Incus host:

```bash
incus profile create custom-profile
incus profile edit custom-profile
```

### Multi-Host Deployment

Incus containers can run on remote workers via SSH:

1. Configure worker host in main config
2. SSH tunnel forwards Incus socket to master
3. Bot scheduler picks least-loaded worker
4. Container created on selected worker host

See [Deployment Guide](../deployment.md) for worker configuration.

## Best Practices

1. **Right-size resources** - Don't over-allocate memory/CPU
2. **Use appropriate images** - Alpine for lightweight, Ubuntu for flexibility
3. **Test locally** - Start with smaller resource limits, scale up as needed
4. **Enable Docker only if needed** - `dockerAccess: true` uses more resources
5. **Monitor container state** - Use `incus info bot-name` to check status
6. **Snapshot before updates** - `incus snapshot bot-name snap-v1` before major changes

## Further Reading

- [Configuration Reference](configuration.md) - Full sandbox options
- [Deployment Guide](../deployment.md) - Multi-host Incus setup
- [Incus Documentation](https://linuxcontainers.org/incus/docs/) - Incus specifics
- [LXC Documentation](https://linuxcontainers.org/lxc/documentation/) - LXC fundamentals

## Examples

### Python Data Science Bot

```json
{
  "id": "data-scientist",
  "soul": "./soul.md",
  "sandbox": {
    "type": "incus",
    "incusImage": "images:ubuntu/24.04/cloud",
    "memory": "3g",
    "cpus": 3
  }
}
```

Automatically has access to apt-get to install pandas, numpy, jupyter, etc.

### Full-Stack Developer Bot

```json
{
  "id": "full-stack-dev",
  "soul": "./soul.md",
  "sandbox": {
    "type": "incus",
    "incusImage": "images:ubuntu/24.04/cloud",
    "memory": "4g",
    "cpus": 4,
    "dockerAccess": true
  }
}
```

Can clone projects, run docker compose, work with multi-service stacks.

### Lightweight CI Helper

```json
{
  "id": "ci-helper",
  "soul": "./soul.md",
  "sandbox": {
    "type": "incus",
    "incusImage": "images:alpine/3.20",
    "memory": "512m",
    "cpus": 1
  }
}
```

Minimal footprint for simple CI/CD tasks.
