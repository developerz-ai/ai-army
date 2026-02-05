# Phase 10: Hot Reload

**Goal**: nginx-style validate and reload (no full restart)
**Dependencies**: All previous phases
**Deliverables**: 4 files, 4 tests

---

## Files to Implement

### 1. Config Watcher
**File**: `src/config/ConfigWatcher.js`
**Test**: `test/integration/config/ConfigWatcher.test.js`

**Class**: `ConfigWatcher(orchestrator: Orchestrator)`

**Methods**:
- `async watch(paths)` → `void`
  Watch config.json, bots/**/*.json, bots/**/*.md

- `async validateAndReload(changedPath)` → `{success, errors?}`
  Validate → Reload if valid → Return result

- `stop()` → `void`
  Stop file watching

**Implementation** (uses chokidar):
```javascript
import chokidar from 'chokidar';

async watch(paths) {
  const watcher = chokidar.watch(paths, {
    persistent: true,
    ignoreInitial: true
  });

  watcher.on('change', async (path) => {
    console.log(`📝 Config changed: ${path}`);

    const result = await this.validateAndReload(path);

    if (result.success) {
      console.log('✅ Config reloaded');
    } else {
      console.error('❌ Invalid config, keeping old:');
      result.errors.forEach(e => console.error(`  ${e}`));
    }
  });
}
```

**Tests**:
- ✓ Detects file changes
- ✓ Validates before applying
- ✓ Rejects invalid configs
- ✓ Reloads valid configs
- ✓ Can be stopped

### 2. Bot Reloader
**File**: `src/core/BotReloader.js`
**Test**: `test/integration/core/BotReloader.test.js`

**Class**: `BotReloader(botManager, containerPool, soulLoader)`

**Methods**:
- `async reloadBotConfig(botId, newConfig)` → `void`
  Update config, no container restart

- `async reloadSoul(botId, newSoulContent)` → `void`
  Update personality, no container restart

- `async reloadContainer(botId, newSandboxConfig)` → `void`
  Graceful container restart (save sessions first)

- `needsContainerRestart(oldConfig, newConfig)` → `boolean`
  Compare sandbox: image, packages, mounts, network

**Reload Strategy**:
```javascript
const changes = detectChanges(oldConfig, newConfig);

if (changes.onlySoul) {
  // Just reload soul, keep container
  bot.soulContent = newSoulContent;

} else if (changes.onlyConfig) {
  // Update config, keep container
  bot.config = newConfig;

} else if (changes.sandboxChanged) {
  // Recreate container
  await containerPool.recycleContainer(botId);
  await botManager.startBot(botId);
}
```

**Tests**:
- ✓ Config change → no container restart
- ✓ Soul change → no container restart
- ✓ Sandbox change → container restarts
- ✓ Sessions preserved during reload

### 3. Reload Command
**File**: `src/cli/ReloadCommand.js`
**Test**: `test/integration/cli/reload.test.js`

**Function**: `async reload()` → `void`

**Flow**:
```javascript
async reload() {
  console.log('🔄 Validating configuration...');

  // 1. Load and validate
  const newConfig = await ConfigLoader.load('./config.json');
  const errors = await ConfigValidator.validateMainConfig(newConfig);

  if (errors.length > 0) {
    console.error('❌ Invalid configuration:');
    errors.forEach(e => console.error(`  ${e}`));
    process.exit(1);
  }

  console.log('✅ Configuration valid');

  // 2. Reload
  console.log('🔄 Reloading...');
  await orchestrator.reload(newConfig);

  console.log('✅ Reload complete');

  // 3. Show status
  const bots = orchestrator.botManager.listBots();
  console.log(`✅ ${bots.length} bots running`);
}
```

**Like nginx**:
```bash
# nginx pattern
nginx -t && nginx -s reload

# ai-army pattern
npx ai-army validate && npx ai-army reload

# Or combined
npx ai-army reload  # Validates first, then reloads
```

**Tests**:
- ✓ Validates before reloading
- ✓ Rejects invalid configs
- ✓ Reloads successfully
- ✓ Reports status

### 4. Admin API Endpoints
**File**: `src/api/AdminRouter.js`
**Test**: `test/integration/api/AdminRouter.test.js`

**Endpoints**:

```javascript
POST /api/admin/reload
  → Validate and reload config

GET /api/admin/status
  → Show bot states, sessions, queue depth

POST /api/admin/bots/:botId/restart
  → Restart specific bot

POST /api/admin/bots/:botId/reload
  → Reload specific bot config
```

**Example**:
```bash
# Reload via API
curl -X POST http://localhost:3000/api/admin/reload \
  -H "Authorization: Bearer ${ADMIN_API_KEY}"

# Response:
{
  "success": true,
  "message": "Configuration reloaded",
  "botsReloaded": 3,
  "changes": [
    "support-bot: soul.md updated",
    "work-bot: config.json updated"
  ]
}
```

**Tests**:
- ✓ Reload endpoint works
- ✓ Status endpoint shows correct data
- ✓ Bot restart endpoint works
- ✓ Requires authentication

---

## Hot Reload Behavior

### Config-Only Changes
```javascript
// Change model from haiku to sonnet
{
  "model": "claude-sonnet-4-5"  // was: claude-haiku-4-5
}
```
**Result**: ✅ Updated immediately, no container restart

### Soul-Only Changes
```javascript
// Edit soul.md personality
```
**Result**: ✅ Reloaded immediately, no container restart

### Sandbox Changes
```javascript
// Add new package
{
  "sandbox": {
    "packages": ["git", "python3", "ripgrep"]  // added: ripgrep
  }
}
```
**Result**: ⚠️ Container restart required (graceful: save sessions → stop → recreate → restore sessions)

---

## Developer Workflow

```bash
# 1. Edit bot personality
vim bots/support/soul.md

# 2. Validate
npx ai-army validate
# Output: ✅ All configurations valid

# 3. Reload
npx ai-army reload
# Output: ✅ Configuration reloaded (1 bot updated)

# 4. Test
# Bot immediately uses new personality
```

**No restart needed** - sessions preserved, bots keep running.

---

## Watch Mode (Development)

**Command**: `npx ai-army dev`

```javascript
// Automatically watches and reloads
async dev() {
  await orchestrator.start();

  const watcher = new ConfigWatcher(orchestrator);
  await watcher.watch([
    './config.json',
    './bots/**/*.json',
    './bots/**/*.md'
  ]);

  console.log('👁️  Watching for config changes...');
  console.log('Press Ctrl+C to stop');
}
```

**Output**:
```
🚀 AI Army started with 3 bots
👁️  Watching for config changes...
📝 Config changed: bots/support/soul.md
✅ Config reloaded
📝 Config changed: bots/work/config.json
✅ Config reloaded
```

---

## Success Criteria

- ✅ `npx ai-army validate` checks without applying
- ✅ `npx ai-army reload` applies if valid
- ✅ Config watcher detects changes
- ✅ Bots reload without losing sessions
- ✅ Container only restarts when sandbox changes
- ✅ API endpoints for reload work
- ✅ `npx ai-army dev` watches and reloads
- ✅ All 4 test suites pass
