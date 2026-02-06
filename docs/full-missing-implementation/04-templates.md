# Missing: Templates & Instances

**Status:** ❌ Not Implemented
**Priority:** Medium
**Design Doc:** [docs/idea/12-templates-and-instances.md](../idea/12-templates-and-instances.md)

## What's Missing

### 1. Template Manager
```javascript
// src/core/template-manager.js - NOT IMPLEMENTED
class TemplateManager {
  async createTemplate(templateConfig)
  async getTemplate(templateId)
  async listTemplates()
  async createInstance(templateId, instanceConfig)
  async listInstances(templateId)
}
```

**Use Cases:**
1. **Load Balancing**: Deploy same bot 5x for high traffic
2. **Multi-Tenant**: Same support bot, different per-customer
3. **Per-Team**: Engineering bot per team with team-specific config

### 2. Database Schema

**Templates table:**
```sql
CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Instances table:**
```sql
CREATE TABLE instances (
  id TEXT PRIMARY KEY,
  template_id TEXT REFERENCES templates(id),
  name TEXT,
  overrides JSONB DEFAULT '{}',
  status TEXT DEFAULT 'stopped',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3. Configuration Format

**Define a template:**
```json
{
  "templates": {
    "support-agent": {
      "soul": "./templates/support/soul.md",
      "provider": "anthropic",
      "model": "claude-sonnet-4-5",
      "channel": {
        "type": "slack",
        "botToken": "${SLACK_BOT_TOKEN}"
      },
      "variables": {
        "teamName": null,
        "teamSlackChannel": null
      }
    }
  }
}
```

**Create instances:**
```json
{
  "instances": [
    {
      "template": "support-agent",
      "id": "support-agent-team-a",
      "overrides": {
        "name": "Team A Support",
        "variables": {
          "teamName": "Team A",
          "teamSlackChannel": "C123456"
        }
      }
    },
    {
      "template": "support-agent",
      "id": "support-agent-team-b",
      "overrides": {
        "name": "Team B Support",
        "variables": {
          "teamName": "Team B",
          "teamSlackChannel": "C789012"
        }
      }
    }
  ]
}
```

### 4. Template Variables

**Soul file with variables:**
```markdown
You are the support agent for {{teamName}}.

Monitor the {{teamSlackChannel}} channel for support requests.
```

**Variable substitution:**
```javascript
function applyVariables(text, variables) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return variables[key] || '';
  });
}
```

### 5. Instance Management

**CLI commands needed:**
```bash
# Create instance from template
ai-army instance create support-agent team-c \
  --override teamName="Team C" \
  --override teamSlackChannel="C345678"

# List instances
ai-army instance list

# Scale template (create N instances)
ai-army instance scale support-agent --count 5

# Stop instance
ai-army instance stop support-agent-team-a

# Remove instance
ai-army instance rm support-agent-team-a
```

## Current State

**What Works:**
- Bot loading with arbitrary configs
- Config merging (defaults + bot config)

**What Doesn't Work:**
- Template definitions
- Instance creation from templates
- Variable substitution in soul/config
- Instance registry in database
- Instance lifecycle management

## Implementation Path

### Step 1: Database Schema
1. Create migration for `templates` and `instances` tables
2. Add indexes for lookups
3. Test schema with manual inserts

### Step 2: Template Manager
1. Implement `TemplateManager` class
2. CRUD operations for templates
3. Store templates in PostgreSQL
4. Validate template configs

### Step 3: Instance Creation
1. Implement `createInstance()` logic
2. Merge template config + instance overrides
3. Create bot from merged config
4. Store instance record in database

### Step 4: Variable Substitution
1. Implement template variable parser
2. Apply variables to soul content
3. Apply variables to config values (strings only)
4. Support nested variables

### Step 5: CLI Integration
1. Create `InstanceCommand` class
2. Add `instance create/list/scale/stop/rm` subcommands
3. Wire to `TemplateManager`
4. Test instance lifecycle

### Step 6: Orchestrator Integration
1. Load instances from database on startup
2. Create bot for each instance
3. Handle instance-specific workspace directories
4. Support instance-specific channels

## Files to Create

```
src/core/template-manager.js
src/core/instance-manager.js
src/utils/VariableSubstitutor.js
src/cli/InstanceCommand.js
test/unit/template-manager.test.js
test/integration/instances.test.js
migrations/012_templates.sql
migrations/013_instances.sql
```

## Example Use Case

**SaaS Scenario:**
```javascript
// Template: customer support bot
const template = {
  id: 'customer-support',
  soul: 'You are support for {{companyName}}',
  model: 'claude-sonnet-4-5'
};

// Create instance for each customer
await templateManager.createInstance('customer-support', {
  id: 'support-acme-corp',
  overrides: {
    variables: { companyName: 'Acme Corp' },
    channel: {
      type: 'slack',
      workspace: 'acmecorp.slack.com'
    }
  }
});
```

## Dependencies

- PostgreSQL storage (already exists)
- BotManager (already exists)
- ConfigLoader (already exists)

## Complexity: Medium
- Template inheritance logic
- Variable substitution
- Database schema design
- Less complex than distributed workers
