# Version Control - Everything in Git

## Overview

**Like Rails**, your entire bot configuration is in version control:
- Bot configs (JSON)
- Soul files (Markdown)
- Dockerfiles
- Skills
- Deployment configs

**Benefits:**
- Track changes to bot personalities
- Roll back to previous versions
- Collaborate on bot configurations
- Deploy from git branches
- CI/CD integration

## What Goes in Git

### ✅ COMMIT to Git

```
my-ai-army/
├── .gitignore
├── package.json
├── docker-compose.yml
├── config.json              ✅ Main config (no secrets)
├── bots/                    ✅ All bot definitions
│   ├── support/
│   │   ├── config.json      ✅ Bot config
│   │   ├── soul.md          ✅ Personality
│   │   └── Dockerfile       ✅ Environment
│   └── code-reviewer/
│       └── ...
├── skills/                  ✅ Custom skills
├── migrations/              ✅ Database migrations
├── templates/               ✅ Bot templates
└── README.md                ✅ Project docs
```

### ❌ DO NOT COMMIT

```
my-ai-army/
├── .env                     ❌ Secrets (add to .gitignore)
├── .env.local               ❌ Local overrides
├── data/                    ❌ Bot workspaces (runtime data)
│   ├── support/
│   │   ├── memory/          ❌ Generated files
│   │   ├── sessions/        ❌ User conversations
│   │   └── scratch/         ❌ Working files
│   └── ...
├── logs/                    ❌ Application logs
└── node_modules/            ❌ Dependencies
```

### .gitignore

```gitignore
# Secrets
.env
.env.local
.env.*.local

# Runtime data
data/
logs/
*.log

# Dependencies
node_modules/
npm-debug.log

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo

# Docker
docker-compose.override.yml
```

## Configuration Without Secrets

Configs reference environment variables, never contain secrets:

### ✅ Good (commit this)

```json
{
  "providers": {
    "anthropic": {
      "type": "anthropic",
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  },
  "channels": {
    "slack": {
      "type": "slack",
      "botToken": "${SLACK_BOT_TOKEN}",
      "appToken": "${SLACK_APP_TOKEN}"
    }
  }
}
```

### ❌ Bad (never commit this)

```json
{
  "providers": {
    "anthropic": {
      "apiKey": "sk-ant-api03-actually-real-key-here"  // NEVER!
    }
  }
}
```

## Git Workflow

### Development Flow

```bash
# 1. Create feature branch
git checkout -b feature/add-devops-bot

# 2. Add new bot
mkdir bots/devops
cat > bots/devops/config.json << EOF
{
  "soul": "./soul.md",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5"
}
EOF

cat > bots/devops/soul.md << EOF
You are a DevOps assistant.
EOF

# 3. Test locally
docker-compose up -d
# ... test the bot ...

# 4. Commit
git add bots/devops/
git commit -m "Add DevOps assistant bot"

# 5. Push and create PR
git push origin feature/add-devops-bot
gh pr create

# 6. After review, merge
git checkout main
git pull

# 7. Deploy to production
git tag v1.2.0
git push --tags
cap production deploy  # Or your deployment tool
```

### Tracking Changes

Every change to bots is tracked:

```bash
# See history of a bot's soul file
git log bots/support/soul.md

# Compare versions
git diff v1.0.0..v1.1.0 bots/support/soul.md

# See who changed what
git blame bots/support/config.json

# Rollback to previous version
git checkout v1.0.0 -- bots/support/
docker-compose restart
```

## Branch Strategy

### Main Branch

Production configuration:

```
main
├── bots/support/      (production personality)
├── bots/code-review/  (production config)
└── config.json        (production settings)
```

### Development Branch

Test new features:

```
develop
├── bots/support/      (testing new responses)
├── bots/experimental/ (new bot being tested)
└── config.json
```

### Feature Branches

New bots or major changes:

```
feature/add-sales-bot
feature/update-support-personality
feature/add-linear-integration
```

## Deployment from Git

### Automatic Deployment (GitOps)

Push to main → auto-deploy:

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Deploy to production
        run: |
          ssh deploy@vps.example.com "
            cd /opt/ai-army &&
            git pull origin main &&
            docker-compose up -d --build
          "
```

### Tag-Based Releases

Deploy specific versions:

```bash
# Create release
git tag -a v1.2.0 -m "Add devops bot, update support personality"
git push --tags

# Deploy specific version
ssh deploy@vps
cd /opt/ai-army
git fetch --tags
git checkout v1.2.0
docker-compose up -d --build
```

### Rollback

```bash
# Quick rollback to previous version
git checkout v1.1.0
docker-compose up -d --build

# Or revert commits
git revert HEAD
git push
# Auto-deploy triggers
```

## Environment-Specific Configs

Different configs per environment:

```
my-ai-army/
├── config.json                 # Base config
├── config.development.json     # Dev overrides
├── config.staging.json         # Staging overrides
└── config.production.json      # Production overrides
```

Load based on environment:

```javascript
// index.js
const env = process.env.NODE_ENV || 'development';
const baseConfig = require('./config.json');
const envConfig = require(`./config.${env}.json`);

const config = deepMerge(baseConfig, envConfig);
```

Or use git branches:

```
main         → production config
staging      → staging config
develop      → dev config
```

## Secrets in Version Control

**Never commit secrets.** Use `.env` files:

### .env (not committed)

```bash
ANTHROPIC_API_KEY=sk-ant-real-key
SLACK_BOT_TOKEN=xoxb-real-token
```

### .env.example (committed)

```bash
# Copy to .env and fill in values
ANTHROPIC_API_KEY=
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=
DISCORD_BOT_TOKEN=
GITHUB_TOKEN=
```

## Bot Soul Version History

Track how bot personalities evolve:

```bash
# View soul file history
git log --oneline bots/support/soul.md

# Output:
# a3f2c1b Update support bot to be more empathetic
# 8d4e5f6 Add troubleshooting guidelines
# c2a1b3d Initial support bot personality

# Compare versions
git diff 8d4e5f6..a3f2c1b bots/support/soul.md

# Shows:
# + Be empathetic and understanding
# + Acknowledge user frustration before solving
```

This is powerful for:
- A/B testing personalities
- Tracking what changes improved/worsened responses
- Collaborating on bot behavior

## Multi-Environment Deployment

### Repository Structure

```
my-ai-army/
├── environments/
│   ├── development/
│   │   ├── docker-compose.yml
│   │   └── .env.example
│   │
│   ├── staging/
│   │   ├── docker-compose.yml
│   │   └── .env.example
│   │
│   └── production/
│       ├── docker-compose.yml
│       ├── .env.example
│       └── terraform/
│
├── bots/
└── config.json
```

### Deploy to Staging

```bash
cd environments/staging
cp .env.example .env
vim .env  # Staging secrets

docker-compose up -d
```

### Promote to Production

```bash
# Same code, different env
cd environments/production
cp .env.example .env
vim .env  # Production secrets

docker-compose up -d
```

## Collaboration

Multiple developers working on same bot army:

### Developer 1: Adding new bot

```bash
git checkout -b add-sales-bot
mkdir bots/sales
# ... create config and soul ...
git commit -m "Add sales assistant bot"
git push
```

### Developer 2: Updating support bot

```bash
git checkout -b update-support-personality
vim bots/support/soul.md
# ... make changes ...
git commit -m "Make support bot more empathetic"
git push
```

### Review and Merge

```bash
# Review PR
gh pr view 123
gh pr diff 123

# Test locally
gh pr checkout 123
docker-compose up -d
# ... test the bot ...

# Merge
gh pr merge 123

# Deploy
cap production deploy
```

## Configuration Schema Validation

Validate configs in CI:

```yaml
# .github/workflows/validate.yml
name: Validate Config

on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node
        uses: actions/setup-node@v3

      - name: Install framework
        run: npm install

      - name: Validate configs
        run: npx ai-army validate

      - name: Check for secrets
        run: |
          if grep -r "sk-ant-" bots/; then
            echo "Found API key in config!"
            exit 1
          fi
```

## Monorepo vs Separate Repos

### Option 1: Monorepo (Recommended)

One repo with all bots:

```
acme-ai-army/
├── bots/
│   ├── support/
│   ├── engineering/
│   └── sales/
└── config.json
```

**Pros:**
- Single deployment
- Shared skills
- Easier to manage

### Option 2: Separate Repos

One repo per bot:

```
acme-support-bot/
├── config.json
└── bots/
    └── support/

acme-engineering-bot/
├── config.json
└── bots/
    └── engineering/
```

**Pros:**
- Independent deployments
- Different teams own different bots
- Clearer ownership

**Cons:**
- More complex orchestration
- Shared config duplicated

## Changelog

Track what changed:

### CHANGELOG.md (committed)

```markdown
# Changelog

## [1.2.0] - 2026-02-05

### Added
- DevOps bot for deployment automation
- Linear integration for support bot

### Changed
- Support bot personality - more empathetic responses
- Code reviewer now checks for security issues

### Fixed
- Engineering bot crashing on large diffs

## [1.1.0] - 2026-02-01

### Added
- Code reviewer bot
- GitHub MCP integration

## [1.0.0] - 2026-01-15

### Added
- Initial release
- Support bot on Slack
```

## Infrastructure as Code

Deployment infrastructure in version control:

```
my-ai-army/
├── terraform/
│   ├── main.tf              ✅ VPS provisioning
│   ├── variables.tf
│   └── outputs.tf
│
├── ansible/
│   ├── playbook.yml         ✅ Server setup
│   └── roles/
│
└── k8s/
    ├── deployment.yaml      ✅ Kubernetes configs
    └── service.yaml
```

Everything is code. Everything is versioned.

## Git Tags for Releases

```bash
# Semantic versioning
git tag v1.0.0  # Initial release
git tag v1.1.0  # New bot added
git tag v2.0.0  # Breaking config change

# Deploy specific version
git checkout v1.1.0
docker-compose up -d
```

## Summary

**Like Rails, your entire application lives in git:**

- `rails new myapp` → `npx ai-army init`
- Define models in Ruby → Define bots in JSON/Markdown
- `config/routes.rb` → `config.json`
- `db/migrate/` → `migrations/`
- `Gemfile` → `package.json`
- Deploy with Capistrano → Deploy with Docker Compose/Capistrano/K8s

**Everything versioned. Everything trackable. Everything deployable.**

Your bot army evolves with your codebase. Every change is tracked. Every version is deployable.
