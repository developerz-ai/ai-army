---
description: Prove a change in developerz-ai/ai-army before committing or opening a pull request — the repo's own install, run and check commands. Use before every commit.
applies: [typescript, javascript, node]
---

# Verify a change in developerz-ai/ai-army

> House skill — established by dz-runner setup mode from this repo’s own
> detected commands. Correct it in place; setup never overwrites a skill that exists.

## The one gate

`bin/check` is the local gate: one command that mirrors every job in
`.github/workflows/ci.yml` — `lint`, `unit-tests`, `integration-tests`, `e2e-tests`
and `validate-demo` — so a change that passes it locally matches what CI grades.

CI does **not** run it. `.github/workflows/ci.yml` runs those five jobs separately (plus
an `all-checks` job that only echoes once those five pass) and never invokes
`bin/check`. The repo’s pre-commit hook (`.githooks/pre-commit`) does run it, but only
once you activate it per clone: `git config core.hooksPath .githooks`.

| Step | Command | What it is |
|------|---------|------------|
| install | `bin/setup` | `npm ci` for the root and `npm ci --prefix demo` (CI’s `validate-demo` job needs the demo deps); copies `.env.example` to `.env` when `.env` is missing (an existing `.env` is never overwritten); `docker compose up -d --wait postgres`; creates the `ai_army_test` database when it is missing |
| run | `bin/dev` | node bin/cli.js dev — on developerz.ai runs, start it with code_bash_background when you need a running stack |
| prove | `bin/check` | guards its preconditions, then runs `npm run lint`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e` and `(cd demo && npm run validate)` with `DATABASE_URL=postgresql://ai_army:ai_army_dev@localhost:5432/ai_army_test` and `TEST_MODE=true` — exit 0 pass, 75 a precondition is unmet, any other non-zero the change is red |
| stop | `bin/stop` | docker compose stop — on developerz.ai runs, the platform runs this when your session ends — do not stop the stack yourself |

## What `bin/check` actually does

1. **Preconditions first.** A missing dependency tree — the root `node_modules`
   (`npm run` needs it) or `demo/node_modules` (`npx ai-army` in the demo resolves
   there) — or a test database that does not answer at
   `postgresql://ai_army:ai_army_dev@localhost:5432/ai_army_test` (or a database user
   that can neither create nor superuser-create the per-worker test databases), ends
   the run with exit **75**. The gate refused to grade: the environment is missing a
   resource — run `bin/setup` and run the gate again.
2. **Then the change.** One step per ci.yml job: `npm run lint`, `npm run test:unit`,
   `npm run test:integration`, `npm run test:e2e` (unit → integration → e2e) and
   `(cd demo && npm run validate)`, with `DATABASE_URL` pointed at `ai_army_test` and
   `TEST_MODE=true`. A genuine failure exits non-zero, and the change is red.

## Rules

- Run every command from the repo root — the scripts `cd` there themselves.
- `bin/check` red is not a pull request. Fix the cause, never silence the gate.
- `bin/check` exiting 75 is not a red change either — that is the environment. Fix the
  environment (usually `bin/setup`) and run the gate again.
- The gate's output never carries a credential. The test database URL holds the
  password, and gate output ends up in captured logs: refuse by naming the
  resource (the test database) and the remedy (run `bin/setup`), never the URL.

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
