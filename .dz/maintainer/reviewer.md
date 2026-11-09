# Reviewer instructions — developerz-ai/ai-army

> Read by the developerz.ai reviewer at EVERY review of this repository, at the reviewed
> commit, as this repo's own layer of the reviewer's prompt — established by dz-runner setup mode.
> It refines the platform rules (a finding is cited or withheld; the bot always discloses)
> and never overrides them. Edit freely; keep it under 12,000 characters — past that it is cut.

## Stack

Node 22+ / npm / ES modules. The gate is `bin/check` (lint, unit, integration, e2e, and demo config validation — one step per job in .github/workflows/ci.yml): a change that does not pass it is not proven, whatever its description says.

## Review conventions

Hold a change to these; each names where it comes from. Cite the file you saw break the rule.

- ES modules only, `.js` extension on every relative import (CLAUDE.md, `package.json` `"type": "module"`).
- A new file exports its primary class/function by name and adds a default export alongside it; never default-export-only (CLAUDE.md).
- File names: `PascalCase.js` for class files, `kebab-case.js` for non-class modules; match the neighbouring file (CLAUDE.md).
- Imports grouped: Node built-ins first, then project imports (CLAUDE.md).
- JSDoc on classes and exported functions (CLAUDE.md). Errors are `Error` subclasses carrying `operation`, `botId` and `cause` (CLAUDE.md).
- `const` over `let`, no `var`, object shorthand, arrow callbacks, template literals, prefer destructuring; unused params and caught errors prefixed `_` (`eslint.config.js`).
- Tests use `node:test` + `node:assert/strict` (`describe`/`test`/`beforeEach`), named `PascalCase.test.js`, in `test/unit/` mirroring `src/` or co-located `src/**/*.test.js`. No Jest or Mocha (CLAUDE.md, CONTRIBUTING.md).
- The API is Node's built-in `http` (`src/api/api-server.js`, routers in `src/api/routers/`). Flag any Express/Fastify dependency (CLAUDE.md).
- Database access: `src/adapters/storage/postgres.js` is the only file that imports `pg` and owns the pool. Everything else runs SQL through `storage.query(sql, params)` or `storage.transaction(cb)`, with `$1, $2, …` placeholders. Flag string-interpolated values, or a new `Pool`/`Client` outside the adapter (CLAUDE.md).
- Migrations (`migrations/NNN_description.sql`): never edit a shipped file; schema changes are new, higher-numbered files, additive and idempotent (`IF NOT EXISTS`, `ON CONFLICT`). A new column the adapter reads must update `src/adapters/storage/postgres.js` in the same change (CLAUDE.md).
- Secrets are `${ENV_VAR}` references in config, never inline values; logs and errors go through `ErrorHandler.redactSecrets()`, and log a key prefix, never the key (CLAUDE.md).
- A bot is a directory: `bots/<id>/config.json` + `soul.md` only; the root `config.json` `bots` map is a fallback, not required. New config fields go in the zod schema `src/config/ConfigValidator.js`; do not relax the validator to make a config pass (CLAUDE.md).
- New features ship with tests (CONTRIBUTING.md, Before Creating a PR); a changed behaviour with no test covering it is a finding.

## Gates that matter

`bin/check` is the local mirror of `.github/workflows/ci.yml`, one step per job. A change is proven only when every job is green and the `all-checks` aggregator ("All Checks Passed") passes:

- `lint` → `npm run lint` (eslint + prettier as a lint rule).
- `unit-tests` → `npm run test:unit` (no database).
- `integration-tests` → `npm run test:integration` (needs `DATABASE_URL`, Postgres service).
- `e2e-tests` → `npm run test:e2e` (needs `DATABASE_URL`, `TEST_MODE=true`).
- `validate-demo` → `cd demo && npx ai-army validate` (`npm run validate` locally).
- `all-checks` → fans in the five jobs above; red or missing means not mergeable.

`bin/check` exit 75 means the environment is missing deps (`node_modules` or `demo/node_modules`), not that the change is bad: do not blame the diff for it. Any other non-zero exit is a real failure. Never accept a change that skips, weakens or deletes a test, lint rule or validator to get green. A diff touching `bots/` or root `config.json` must still pass `npm run validate`.

## Never flag

- Formatting Prettier owns (single quotes, semicolons, 2-space indent, 100 columns, ES5 trailing commas); `npm run lint` enforces it.
- Anything `bin/check` or CI already enforces and shows green: lint rules, test failures, config validation.
- Lockfile churn in `package-lock.json` (and `demo/package-lock.json`) that follows a `package.json` change; judge the `package.json` change, not the lock diff.
- `demo/`: a separate user project with its own `demo/CLAUDE.md` that consumes the framework as a package. Its code is not framework code; hold it only to `validate-demo`.
- `node_modules/`, build output and other generated files.
- Existing files that mix `PascalCase.js` and `kebab-case.js` names in `src/`; only flag a new file that breaks the rule.
- Shipped migrations `migrations/001..` as they stand: they are immutable history, not a place for style findings.
- Choices the repo made on purpose: no Express/Fastify, `node:test` rather than Jest, named exports with an optional default alongside.
