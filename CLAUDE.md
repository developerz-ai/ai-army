# AI Army

Open-source framework for orchestrating AI workers across distributed servers.
Bots run in sandboxes, talk to channels (Slack, Discord, REST), and keep state in PostgreSQL.

**This file is the repository's single brain.** `AGENTS.md` is a pointer to it, never a
second copy. Refine it in place — do not create a parallel brain file.

```bash
./bin/setup   # install dependencies, create .env, start PostgreSQL, create the test database
./bin/dev     # run the app (orchestrator + REST API)
./bin/check   # prove it: lint, unit, integration, e2e, demo validate
```

`./bin/setup` is idempotent — it never overwrites an existing `.env`, and it
starts PostgreSQL 18 with its data volume (`pgdata`) mounted at
`/var/lib/postgresql`, the path PostgreSQL 18 expects. The legacy
`/var/lib/postgresql/data` path makes the container refuse to start.

Secrets live in `.env` (gitignored); `config.json` references them as
`${ENV_VAR}`. `.env.example` ships development placeholders — replace them
with real keys before using a provider.

## Create New Bot

A bot lives in its own directory under `bots/` — see
[Registering a bot](#registering-a-bot) for the full procedure.

## Rules

1. **`bin/check` is the gate.** A change is not done until `bin/check` is green. It runs
   lint + the full test suite against a live test database. `bin/check` red is not a PR.
   Fix the cause; never silence the gate.
2. **A bot is registered by its directory, not by a root-config entry.** Create
   `bots/<id>/config.json` (+ `soul.md`) and the bot is discovered. No root
   `config.json` edit is required — see [Registering a bot](#registering-a-bot).
3. **Secrets are references, never values.** Write `${ENV_VAR}` in config. Never inline
   a key, a token or a password.
4. **Never edit a shipped migration.** Schema changes are new numbered files.
5. **The API is Node's built-in `http`.** There is no Express and no Fastify. Do not
   introduce one.
6. **All database access goes through the storage adapter.** `pg` and the connection
   pool are owned by `src/adapters/storage/postgres.js` — it is the only file that
   imports `pg`. SQL text may live in the caller (`src/core/`, `src/api/routers/`,
   `src/queue/`, `src/audit/`, `src/webhooks/`, `src/monitoring/`), but it must be
   executed via `storage.query(sql, params)` or `storage.transaction(cb)` with
   `$1, $2, …` placeholders. Never open a pool or a client yourself.

## Technology Stack

| Concern | Technology |
|---------|-----------|
| Runtime | Node.js **>= 22** (`engines.node` in `package.json`) |
| Module system | **ES Modules** — `"type": "module"`, `import`/`export`, named exports (+ an optional default export for a module's primary class/function) |
| Test runner | **`node:test`** with `node:assert/strict` — no Jest, no Mocha |
| Database | **PostgreSQL 18** (`postgres:18-alpine`), driven by **`pg`** |
| HTTP API | Node's **built-in `http` module** (`src/api/api-server.js`) — no Express/Fastify |
| CLI | **`commander`** (`bin/cli.js`) |
| Config validation | **`zod`** (`src/config/ConfigValidator.js`) |
| Config watching | **`chokidar`** (`src/config/ConfigWatcher.js`) |
| AI providers | **`ai`** SDK with **`@ai-sdk/anthropic`**, **`@ai-sdk/openai`**, **`@openrouter/ai-sdk-provider`** |
| Sandboxing | Pluggable backend abstraction (`src/execution/container-backend.js`) for the **docker / incus** sandbox types. **`incus`** (`incus-backend.js`) is implemented; `docker` is the documented sandbox type but has **no** backend implementation in `src/` — `ConfigValidator` accepts only `incus` and `just-bash` |
| Channels | **`@slack/bolt`**, **`discord.js`**, built-in REST adapter |
| MCP | **`@modelcontextprotocol/sdk`** |
| Remote workers | **`ssh2`** (`src/worker/ssh-tunnel.js`) |
| Lint / format | **eslint 9** + **prettier** via `eslint-plugin-prettier` (`eslint.config.js`) |
| Runtime topology | Postgres 18 + app service (`docker-compose.yml`); bots sandboxed via the execution backends |

## Commands

| Command | Purpose |
|---------|---------|
| `bin/setup` | Install deps (`npm ci`), start Postgres 18, create the `ai_army_test` database |
| `bin/dev` | Run the stack in development mode (`node bin/cli.js dev`, hot reload) |
| `bin/check` | **The gate** — lint, unit, integration, e2e and demo validate against the test database; exits 75 when a precondition is unmet |
| `bin/stop` | Stop the docker-compose services |
| `npm start` | Run the app in production mode (`node src/index.js`) |
| `npm run dev` | Run the app under `node --watch` |
| `npm test` | Run unit, then integration, then e2e — in that order |
| `npm run test:unit` | `test/unit/**`, `test/helpers/**`, `src/**/*.test.js` — fast, no database |
| `npm run test:integration` | `test/integration/**` — needs `DATABASE_URL` |
| `npm run test:e2e` | `test/e2e/**` — needs `DATABASE_URL` and a live stack |
| `npm run test:watch` | Watch mode across `src/**/*.test.js` and `test/**/*.test.js` |
| `npm run lint` | `eslint src/ bin/ test/` — also runs Prettier as an ESLint rule |
| `npm run lint:fix` | Same, with `--fix` |
| `npm run validate` | Validate `config.json` and every `bots/*/config.json` (Zod schemas) |
| `npm run migrate` | Apply pending SQL migrations (`node bin/cli.js migrate`) |
| `node bin/cli.js <subcommand>` | The CLI proper: `init`, `validate`, `migrate`, `start`, `dev`, `status`, `reload`, `instance` (create/list/scale/stop/rm), `server` (add/list/test), `worker` (list/status/stop/start/update), `deploy`, `generate worker` |

`bin/check` guards its preconditions (both dependency trees, then the test database)
and then runs one step per ci.yml job: `npm run lint`, `npm run test:unit`,
`npm run test:integration`, `npm run test:e2e` and `(cd demo && npm run validate)`. A
missing resource exits 75 — the environment, not the change.

## Project Structure

```
ai-army/
├── bin/                     # Executables: cli.js (commander), setup, dev, check, stop
├── bots/                    # Bot definitions — one directory per bot
│   └── <bot-id>/
│       ├── config.json      # Bot config (model, tools, sandbox, workspace)
│       └── soul.md          # Personality — the bot's system prompt
├── src/
│   ├── index.js             # Entrypoint (npm start)
│   ├── core/                # Orchestration: orchestrator, bot-manager, session-manager,
│   │                        #   message-router, message-processor, channel-manager, template-manager,
│   │                        #   worker-assigner, worker-registry, BotReloader
│   ├── adapters/            # Ports to the outside world
│   │   ├── channels/        #   Slack, Discord, REST
│   │   ├── secrets/         #   env, Bitwarden, 1Password
│   │   └── storage/         #   postgres.js — owns the pool; the only module importing `pg`
│   ├── api/                 # REST API: api-server.js (node:http), AdminRouter.js,
│   │   │                    #   auth-middleware.js, rate-limiter.js
│   │   └── routers/         #   bot, session, queue, worker, template, server, metrics,
│   │                        #   audit, health routers
│   ├── config/              # ConfigLoader, ConfigValidator (zod), ConfigWatcher, project-*
│   ├── database/            # MigrationRunner
│   ├── execution/           # Sandbox backends: container-backend (abstract), incus-backend,
│   │                        #   incus-client, container-pool, tool-executor
│   ├── mcp/                 # MCP client, manager, tool-converter
│   ├── models/              # model-factory, provider-registry, capabilities
│   ├── queue/               # message-queue, queue-worker, concurrency-controller
│   ├── secrets/             # secrets-manager, secret-cache, reference-parser
│   ├── skills/              # skill-loader, skill-parser, skill-registry
│   ├── tools/               # bash-tool, file-tools, tool-registry
│   ├── webhooks/            # webhook-manager, delivery-manager, webhook-worker
│   ├── worker/              # ssh-tunnel
│   ├── cli/                 # One file per CLI subcommand (ValidateCommand, MigrateCommand, …)
│   ├── agent/               # agent-runner
│   ├── audit/               # audit-logger, audit-retention
│   ├── monitoring/          # HealthMonitor, MetricsCollector, Alerter, health-checks
│   └── utils/               # logger, ErrorHandler, SoulLoader, VariableSubstitutor
├── migrations/              # NNN_description.sql — 001..012, never edited after shipping
├── test/
│   ├── unit/                # Mirrors src/ layout
│   ├── integration/         # Needs a live database
│   ├── e2e/                 # Needs a live stack
│   ├── helpers/             # Shared fixtures + setup
│   └── fixtures/
├── skills/                  # Runtime bot skills: code-review/, deploy/
├── templates/               # Instance/worker/project templates
├── demo/                    # A separate user project with its own CLAUDE.md — not framework code
├── docs/                    # Long-form documentation
├── scripts/                 # Deployment and server-provisioning shell scripts
├── mcp-servers/             # MCP server packages
├── config.json              # Root config: defaults, providers, database, api auth, channels
└── .claude/
    ├── skills/              # House skills: verify-change, onboarding, database-migrations
    └── agents/              # Repo specialists: config, channel-adapters, postgres-migrations
```

## Conventions

- **ES Modules only.** `"type": "module"`; `import`/`export`; **named exports**; a module
  may also provide a **default export for its primary class or function** (the tree's
  convention: `export class BotReloader` + `export default BotReloader`); **`.js` extension
  required on every relative import**. In a **new** file, export the primary class/function
  as a named export and add the default export alongside it — never default-export-only.
- **File names:** `PascalCase.js` for class files (`ConfigValidator.js`, `AdminRouter.js`,
  `BotReloader.js`); `kebab-case.js` for non-class modules (`bot-manager.js`,
  `session-manager.js`, `orchestrator.js`). The tree mixes both styles today — follow the
  rule, and match the neighbouring file when you add one.
- **Identifiers:** `camelCase` for variables and functions, `PascalCase` for classes.
  Unused parameters and caught errors are prefixed with `_` (enforced by ESLint).
- **Tests:** `node:test` + `node:assert/strict`, using `describe` / `test` / `beforeEach`.
  Test files are `PascalCase.test.js`. Unit tests live in `test/unit/` mirroring `src/`,
  or co-located as `src/**/*.test.js`.
- **The API is Node's built-in `http` module** — `createServer` from `node:http`, routing
  in `src/api/routers/`. Express and Fastify are not dependencies; do not add them.
- **Formatting** (Prettier, enforced through ESLint): single quotes, semicolons, 2-space
  indent, 100-column width, ES5 trailing commas.
- **Other ESLint rules:** `const` over `let`, never `var`, object shorthand, arrow
  callbacks, template literals, prefer destructuring.
- **Imports are grouped:** Node built-ins first, then project imports.
- **JSDoc** on classes, exported functions and modules.
- **Errors:** custom `Error` subclasses carrying `operation`, `botId` and `cause`.

## Non-Negotiables

- **Secrets are references, never values.** Every secret in config is `${ENV_VAR}`
  (e.g. `"apiKey": "${OPENROUTER_API_KEY}"`); `ConfigLoader` interpolates them and
  throws when a required variable is missing. Never commit a key, never inline one.
- **Logs and errors are redacted.** `ErrorHandler.redactSecrets()` replaces known key
  shapes with `[REDACTED_<NAME>]` markers, and `AuthMiddleware` logs only a token
  prefix. Log a key prefix, never the key.
- **SQL is parameterized and goes through the storage adapter.** Always `$1, $2, …` —
  never string interpolation of values. `src/adapters/storage/postgres.js` owns the
  pool and is the only module that imports `pg`; every query runs through
  `storage.query(sql, params)` or `storage.transaction(cb)`, including the SQL text in
  `src/core/`, `src/api/routers/` and the worker modules. Opening your own pool or
  client breaks the adapter boundary.
- **Migrations are additive and idempotent.** Add `migrations/NNN_description.sql` with
  a new numeric prefix; never edit a file that has already shipped. Use `IF NOT EXISTS`
  on `CREATE` and `ON CONFLICT` on `INSERT` — the test harness runs migrations
  concurrently in per-worker databases. Each migration runs in its own transaction, and
  applied versions are recorded in `schema_migrations` (skipped by `MigrationRunner`).
  When you add a column the storage adapter reads, update
  `src/adapters/storage/postgres.js` in the same change.

## Registering a bot

A bot is registered by **creating its directory**. Discovery scans `bots/` first
(`_discoverBotConfigs` in `src/core/orchestrator.js`): every `bots/<id>/config.json` is
loaded and keyed by its `id` (falling back to the directory name). The root
`config.json` `bots` map is only a **fallback** for bots that are not on disk, so
adding a bot does **not** require editing the root config.

1. `mkdir bots/<id>` and write `bots/<id>/config.json` — it needs at least `id`;
   `soul` points at the personality file.
2. Write `bots/<id>/soul.md` — the bot's system prompt.
3. `npm run validate` to check the config against the Zod schemas.
4. `npm run dev` (or `npm run reload`) to pick it up.

Config inheritance: root `config.json` `defaults` → bot `config.json` → env overrides.

## Common Tasks

| Task | Where |
|------|-------|
| Add a bot | `bots/<id>/{config.json,soul.md}` — no root-config edit |
| Add a tool | `src/tools/` + register it in `tool-registry.js` |
| Change a bot's personality | `bots/<id>/soul.md` |
| Add a channel adapter | `src/adapters/channels/` (see `.claude/agents/channel-adapters.md`) |
| Add an API endpoint | `src/api/routers/` — node:http routing, no framework |
| Change the schema | new `migrations/NNN_*.sql` (see `.claude/agents/postgres-migrations.md`) |
| Add a config field | `src/config/ConfigValidator.js` (zod schema) |
| Add a test | `test/unit/…` mirroring `src/`, or co-located `*.test.js` |

## House Skills and Specialists

- `.claude/skills/verify-change` — how to prove a change before committing; **`bin/check`
  is the gate**.
- `.claude/skills/onboarding` — how to add or edit a bot under `bots/`.
- `.claude/skills/database-migrations` — how to add and apply a PostgreSQL migration.
- `.claude/agents/postgres-migrations` — the migration rules in full.
- `.claude/agents/config` — configuration and validation rules.
- `.claude/agents/channel-adapters` — how a channel adapter is built.

`demo/` is a **separate user project** that consumes the framework as an npm package.
It has its own `demo/CLAUDE.md`; its code is not framework code.
