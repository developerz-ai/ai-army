# Skills System

## Overview

Skills are **portable, reusable capabilities** that can be attached to bots. Each skill is a folder containing:
- `SKILL.md` - Description, instructions, examples
- Optional scripts and tools

Skills follow the **AgentSkills spec** for portability across different AI systems.

## Skill Directory Structure

```
skills/
├── code-review/
│   ├── SKILL.md
│   ├── templates/
│   │   └── pr-review.md
│   └── scripts/
│       └── analyze-diff.js
├── jira-triage/
│   ├── SKILL.md
│   └── prompts/
│       └── triage-rules.md
├── deploy/
│   ├── SKILL.md
│   ├── scripts/
│   │   ├── deploy.sh
│   │   └── rollback.sh
│   └── config/
│       └── environments.json
└── shared/
    └── summarize/
        └── SKILL.md
```

## SKILL.md Format

```markdown
# Code Review

A skill for reviewing pull requests and providing constructive feedback.

## Activation

This skill is activated when the user asks for a code review or mentions reviewing a PR/MR.

## Instructions

When reviewing code:

1. **Understand the context**
   - Read the PR description
   - Understand what problem is being solved
   - Check the linked issue if any

2. **Review for correctness**
   - Does the code do what it claims?
   - Are there edge cases not handled?
   - Are there potential bugs?

3. **Review for quality**
   - Is the code readable and maintainable?
   - Does it follow project conventions?
   - Is there unnecessary complexity?

4. **Review for security**
   - Are there SQL injection risks?
   - Are secrets properly handled?
   - Is input validated?

5. **Provide feedback**
   - Be constructive and specific
   - Suggest improvements, don't just criticize
   - Praise good patterns

## Examples

### Example 1: Simple PR Review

User: "Review this PR: https://github.com/acme/app/pull/123"

Response: I'll review PR #123. Let me fetch the diff and understand the changes...

[Fetches PR details]

**Summary**: This PR adds user authentication using JWT tokens.

**Observations**:
- ✅ Good: Token expiration is properly handled
- ✅ Good: Passwords are hashed with bcrypt
- ⚠️ Consider: The refresh token rotation could be added for extra security
- ❌ Issue: The JWT secret is hardcoded in `auth.js:45`. This should come from environment variables.

**Suggestions**:
1. Move JWT_SECRET to .env
2. Add rate limiting on the login endpoint
3. Consider adding refresh token rotation

Overall: Good implementation with one security issue to fix.

## Tools

This skill can use:
- `github__get_pull_request` - Fetch PR details
- `github__get_pull_request_diff` - Get the diff
- `bash` - Run linters or analyzers
- `readFile` - Read local files for context

## Configuration

```json
{
  "defaultReviewDepth": "standard",
  "focusAreas": ["security", "performance", "readability"],
  "autoFetchDiff": true
}
```
```

## Skill Configuration in Bot

```json
{
  "skills": [
    "./skills/code-review",
    "./skills/jira-triage",
    "../../skills/shared/summarize"
  ],
  "skillConfig": {
    "code-review": {
      "defaultReviewDepth": "thorough",
      "focusAreas": ["security"]
    }
  }
}
```

## Skill Loader Implementation

```javascript
// src/skills/loader.ts
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import matter from 'gray-matter';

export class SkillLoader {
  async loadSkill(skillPath) {
    const skillMdPath = join(skillPath, 'SKILL.md');
    const content = await readFile(skillMdPath, 'utf8');

    // Parse frontmatter if present
    const { data: frontmatter, content: markdown } = matter(content);

    // Extract sections
    const sections = this.parseSections(markdown);

    return {
      path: skillPath,
      name: frontmatter.name || dirname(skillPath).split('/').pop(),
      description: frontmatter.description || sections.description,
      activation: sections.activation,
      instructions: sections.instructions,
      examples: sections.examples,
      tools: sections.tools,
      config: frontmatter.config || {}
    };
  }

  parseSections(markdown) {
    const sections = {};
    let currentSection = 'description';
    let currentContent = [];

    for (const line of markdown.split('\n')) {
      if (line.startsWith('## ')) {
        if (currentContent.length) {
          sections[currentSection] = currentContent.join('\n').trim();
        }
        currentSection = line.slice(3).toLowerCase().replace(/\s+/g, '_');
        currentContent = [];
      } else {
        currentContent.push(line);
      }
    }

    if (currentContent.length) {
      sections[currentSection] = currentContent.join('\n').trim();
    }

    return sections;
  }

  async loadSkillsForBot(botConfig) {
    const skills = [];

    for (const skillPath of botConfig.skills || []) {
      const resolvedPath = join(dirname(botConfig.configPath), skillPath);
      const skill = await this.loadSkill(resolvedPath);

      // Apply bot-specific config overrides
      if (botConfig.skillConfig?.[skill.name]) {
        skill.config = { ...skill.config, ...botConfig.skillConfig[skill.name] };
      }

      skills.push(skill);
    }

    return skills;
  }
}
```

## Vercel AI SDK Skills Integration

The Vercel AI SDK supports skills via the `bash-tool` package:

```javascript
// Integration with Vercel AI SDK skills
import { createSkillTool } from 'bash-tool';

const { skill, files, instructions } = await createSkillTool({
  skillsDirectory: "./skills",
});

// Skills expose:
// - skill: A tool that can be called to invoke skill-specific behavior
// - files: Filesystem context from skills
// - instructions: Additional system prompt content from skills
```

### From Vercel Changelog (Jan 2026)

> The `bash-tool` package now enables AI SDK agents to leverage the skills pattern alongside filesystem context, Bash execution, and sandboxed runtime capabilities.
>
> Skills work seamlessly with filesystem-based context retrieval. Support for both publicly available skills from skills.sh and custom proprietary implementations.

```javascript
// Example from Vercel docs
const { skill, files, instructions } = await createSkillTool({
  skillsDirectory: "./skills",
});

const { tools } = await createBashTool({
  files,
  extraInstructions: instructions,
});

const agent = new ToolLoopAgent({
  model,
  tools: { skill, ...tools },
});
```

## System Prompt Integration

Skills are injected into the system prompt:

```javascript
// src/agent/prompt-builder.ts
export function buildSystemPrompt(botConfig, skills) {
  const parts = [];

  // Bot soul/identity
  parts.push(botConfig.soulContent);

  // Skills
  if (skills.length > 0) {
    parts.push('\n## Available Skills\n');

    for (const skill of skills) {
      parts.push(`### ${skill.name}`);
      parts.push(skill.description);
      parts.push('\n**Activation:** ' + skill.activation);
      parts.push('\n**Instructions:**\n' + skill.instructions);

      if (skill.examples) {
        parts.push('\n**Examples:**\n' + skill.examples);
      }
    }
  }

  return parts.join('\n\n');
}
```

## Skill Scripts

Skills can include scripts that the bot can execute:

```javascript
// skills/code-review/scripts/analyze-diff.js
#!/usr/bin/env node

// Analyze a git diff and provide metrics
const fs = require('fs');
const diff = fs.readFileSync('/dev/stdin', 'utf8');

const lines = diff.split('\n');
const stats = {
  additions: lines.filter(l => l.startsWith('+')).length,
  deletions: lines.filter(l => l.startsWith('-')).length,
  files: new Set(lines.filter(l => l.startsWith('diff --git')).map(l => l.split(' b/')[1])).size
};

console.log(JSON.stringify(stats, null, 2));
```

Usage in skill:

```markdown
## Tools

You can analyze diffs using the built-in script:

```bash
git diff main..HEAD | node /home/agent/skills/code-review/scripts/analyze-diff.js
```

This returns JSON with addition/deletion counts and files changed.
```

## Public Skills Registry

Skills can be shared via skills.sh or npm:

```bash
# Install a public skill
npx ai-army-skill add @skills/code-review
npx ai-army-skill add @skills/summarize
```

Or reference directly in config:

```json
{
  "skills": [
    "npm:@skills/code-review",
    "npm:@skills/jira-triage",
    "./skills/custom-skill"
  ]
}
```
