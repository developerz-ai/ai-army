---
description: Add or edit a bot under apps/ai-army/bots/. Use for new bot, bot config, soul, personality, add a tool.
applies: [typescript, javascript, node]
---

> House skill — established by dz-runner setup mode from this repo's own evidence, then owned by its maintainers. Correct it in place; setup never overwrites a skill that exists.

1. Create the bot directory: `mkdir -p apps/ai-army/bots/<bot-id>` — the directory name IS the bot id.
2. Write `apps/ai-army/bots/<bot-id>/config.json` with at least `id`, `soul` ("./soul.md"), `provider`, `model`, `tools` and `sandbox`:
   `{"id":"<bot-id>","soul":"./soul.md","provider":"anthropic","model":"claude-sonnet-4-5","tools":["bash","readFile"],"sandbox":{"type":"incus"}}`
3. Write `apps/ai-army/bots/<bot-id>/soul.md` — the personality and behaviour instructions for the bot.
4. Reference every secret as `${ENV_VAR}` in the config; never inline a key. The provider key lives in the `apps/ai-army/config.json` `providers` block, not in the bot config.
5. Register the bot in `apps/ai-army/config.json` under `bots` (with its `channels` binding) so the orchestrator loads it.
6. Validate: `npm run validate`
   fail -> the message names the offending file and field; fix the config, do not loosen `apps/ai-army/src/config/ConfigValidator.js`.
7. Start the army in dev mode and watch it load: `cd apps/ai-army && npx ai-army dev` — confirm the startup log lists the new bot under "Loaded bot".
8. Prove nothing broke: `npm run lint && npm test`.
9. In a running dev session the config watcher picks the change up; outside one, `cd apps/ai-army && npx ai-army reload <bot-id>` validates and reloads it.
