---
description: Add and apply a PostgreSQL schema migration. Use for migration, schema change, new column, new table.
applies: [typescript, javascript, node]
---

> House skill — established by dz-runner setup mode from this repo's own evidence, then owned by its maintainers. Correct it in place; setup never overwrites a skill that exists.

1. Add `apps/ai-army/migrations/NNN_description.sql` where NNN is the next zero-padded integer after the highest existing file. Never edit an already-shipped migration file.
2. Write the SQL idempotently: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`. The test harness and `apps/ai-army/src/database/MigrationRunner.js` both re-apply migrations against fresh per-worker databases, so a non-idempotent statement fails the suite.
3. Put each migration's statements in one file so `MigrationRunner` can apply it inside a single transaction; on failure the migration rolls back and later versions are not attempted.
4. Apply it locally (from the repo root — the root script delegates into the app, and `DATABASE_URL` passes through):
   `DATABASE_URL=postgresql://ai_army:ai_army_dev@localhost:5432/ai_army npm run migrate`
   fail -> the error names the offending statement; fix the SQL, do not skip the file.
5. Confirm the version landed in `schema_migrations`:
   `docker exec ai-army-postgres psql -U ai_army -d ai_army -c "SELECT version, name FROM schema_migrations ORDER BY version;"`
6. If the storage adapter reads the new column, update `apps/ai-army/src/adapters/storage/postgres.js` in the same change.
7. Prove it: `npm run lint && npm test` — the integration and E2E suites recreate the schema from `apps/ai-army/migrations/` and will catch a migration that only works on an already-migrated database.
