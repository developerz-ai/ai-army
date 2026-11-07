---
description: Prove a change in developerz-ai/ai-army before committing or opening a pull request — the repo's own install, run and check commands. Use before every commit.
applies: [typescript, javascript, node]
---

# Verify a change in developerz-ai/ai-army

> House skill — established by dz-runner setup mode from this repo’s own
> detected commands. Correct it in place; setup never overwrites a skill that exists.

## The one gate

`bin/check` is the gate. It runs the same five gates CI runs (.github/workflows/ci.yml), and the pre-commit hook (.githooks/pre-commit) runs it, so a change that passes it locally passes everywhere.

| Step | Command | What it is |
|------|---------|------------|
| install | `bin/setup` | npm ci && npm ci --prefix demo && docker compose up -d --wait postgres && (docker exec ai-army-postgres psql -U ai_army -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='ai_army_test'" \| grep -q 1 \|\| docker exec ai-army-postgres psql -U ai_army -d postgres -c "CREATE DATABASE ai_army_test OWNER ai_army;") |
| run | `bin/dev` | node bin/cli.js dev — on developerz.ai runs, start it with code_bash_background when you need a running stack |
| prove | `bin/check` | ./bin/check — lint, unit, integration, e2e, demo validate; one step per ci.yml job; exits 75 (environment, not the change) if demo/node_modules is missing — run bin/setup |
| stop | `bin/stop` | docker compose stop — on developerz.ai runs, the platform runs this when your session ends — do not stop the stack yourself |

## Rules

- Run every command from the repo root — the scripts `cd` there themselves.
- `bin/check` red is not a pull request. Fix the cause, never silence the gate.

## Exit codes `bin/check` must use

A coding box runs this gate before it commits, and it has to tell a FAILING change
from a gate it could not run — otherwise correct work is thrown away as if it were
red. Exit 1 cannot carry that difference, so one code is reserved:

| Exit | Means | What the platform does |
|------|-------|------------------------|
| 0 | the change passes | commit it |
| 75 | a resource the gate NEEDS is unreachable (a database, a service, a credential) — it refused to grade | refuse the commit, and blame the environment, never the change |
| any other non-zero | the gate ran and the change is red | refuse the commit, and blame the change |

- Guard preconditions FIRST and `exit 75` when one is unmet. `exit 1` there tells the
  platform your change is broken when it is your environment that is.
- Changed a dependency? Re-run `bin/setup` before `bin/check`, or you are proving a stale tree.
- Add the test that fails first, then the fix — a green run that never went red proves nothing.
