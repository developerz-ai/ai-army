# Missing: Skills System

**Status:** ❌ Not Implemented
**Priority:** Medium
**Design Doc:** [docs/idea/07-skills.md](../idea/07-skills.md)

## What's Missing

### 1. Skills Loader
```javascript
// src/skills/skill-loader.js - NOT IMPLEMENTED
class SkillLoader {
  async loadSkill(skillPath)
  async loadFromDirectory(dir)
  validateSkill(skill)
}
```

**Skill Format (Vercel-compatible):**
```
skills/code-review/
├── SKILL.md          # Skill definition (name, description, instructions)
└── tools.js          # Optional: custom tools
```

**SKILL.md:**
```markdown
---
name: code-review
description: Review code for quality and security
---

# Code Review Instructions

When reviewing code:
1. Check for security vulnerabilities
2. Verify error handling
3. Assess code clarity
4. Suggest improvements
```

### 2. Skill Registry
```javascript
// src/skills/skill-registry.js - NOT IMPLEMENTED
class SkillRegistry {
  registerSkill(skill)
  getSkill(name)
  listSkills()
  attachToBot(botId, skillNames)
}
```

**Responsibilities:**
- Store loaded skills in-memory
- Provide skill lookup by name
- Manage bot-to-skill mappings
- Inject skill instructions into bot soul

### 3. Configuration Support

**Bot config** - Skills not processed:
```json
{
  "id": "work-bot",
  "soul": "./soul.md",
  "skills": [
    "code-review",
    "deploy",
    "npm:@ai-army/skill-jira"
  ]
}
```

**Skill References:**
- Local path: `./skills/my-skill`
- Global directory: `code-review` (from `./skills/`)
- NPM package: `npm:@ai-army/skill-jira`

### 4. Soul Enhancement

**Inject skill instructions into bot soul:**
```javascript
// When loading bot with skills
const baseSoul = await soulLoader.load('./soul.md');
const skillInstructions = skills.map(s => s.instructions).join('\n\n');
const enhancedSoul = `${baseSoul}\n\n## Skills\n\n${skillInstructions}`;
```

### 5. Skill Tools

**Custom tools in skills:**
```javascript
// skills/deploy/tools.js
import { tool } from 'ai';

export const deployTool = tool({
  description: 'Deploy application to production',
  parameters: z.object({
    environment: z.enum(['staging', 'production']),
    version: z.string()
  }),
  execute: async ({ environment, version }) => {
    // Deploy logic
  }
});
```

## Current State

**What Works:**
- Soul loading via `SoulLoader`
- Tool registration (manual)
- Config supports arbitrary fields

**What Doesn't Work:**
- Skill discovery and loading
- Skill-to-bot attachment
- Automatic tool injection from skills
- NPM skill package support

## Implementation Path

### Step 1: Skill Format Parser
1. Create `SkillLoader` class
2. Parse SKILL.md frontmatter (name, description)
3. Extract instruction content
4. Validate skill structure

### Step 2: Skill Registry
1. Implement `SkillRegistry` class
2. Load skills from `./skills/` directory
3. Store in-memory Map
4. Add to `Orchestrator` initialization

### Step 3: Configuration Support
1. Extend `ConfigValidator` to validate bot skills
2. Parse `skills` array in bot config
3. Support local/global/npm references
4. Validate skill references exist

### Step 4: Soul Enhancement
1. Extend `SoulLoader` to accept skill instructions
2. Merge skill instructions into bot soul
3. Test instruction injection
4. Handle multiple skills per bot

### Step 5: Tool Integration
1. Support `tools.js` in skill directories
2. Load and register skill tools
3. Attach tools to bot's tool registry
4. Test tool execution

### Step 6: NPM Skills (Future)
1. Support `npm:package-name` syntax
2. Install skill packages dynamically
3. Load from node_modules
4. Version management

## Files to Create

```
src/skills/skill-loader.js
src/skills/skill-registry.js
src/skills/skill-parser.js
test/unit/skill-loader.test.js
test/fixtures/skills/example-skill/SKILL.md
test/fixtures/skills/example-skill/tools.js
```

## Example Skills to Include

```
skills/
├── code-review/
│   └── SKILL.md
├── deploy/
│   ├── SKILL.md
│   └── tools.js
├── triage/
│   └── SKILL.md
└── README.md
```

## Configuration Example

```json
{
  "id": "dev-bot",
  "soul": "./soul.md",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "skills": [
    "code-review",
    "deploy"
  ]
}
```

## Dependencies

- Frontmatter parser (gray-matter or manual)
- Dynamic imports for tools.js
- SoulLoader (already exists)

## Complexity: Medium
- File parsing (SKILL.md frontmatter)
- Dynamic module loading (tools.js)
- Instruction merging
- Simple compared to MCP/Workers
