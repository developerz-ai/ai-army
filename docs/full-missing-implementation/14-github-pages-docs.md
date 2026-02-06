# GitHub Pages for Documentation

**Goal:** Serve `/docs/**/*.md` files as a static documentation site on GitHub Pages
**Reference:** How cybercore-css deploys to https://sebyx07.github.io/cybercore-css

---

## 🎯 Options for Serving Markdown on GitHub Pages

### Option 1: Jekyll (GitHub's Default) ⭐ Recommended

**How it works:**
```
GitHub Pages has built-in Jekyll support
   ↓
Put markdown files in docs/
   ↓
Enable Pages from /docs in repo settings
   ↓
GitHub automatically converts .md → .html
   ↓
https://developerz-ai.github.io/ai-army/
```

**📁 Directory Structure:**
```
ai-army/
├── docs/
│   ├── index.md                      # 📄 Home page
│   ├── _config.yml                   # 🔧 Jekyll configuration
│   │
│   ├── getting-started/
│   │   ├── index.md                  # Landing page
│   │   ├── installation.md
│   │   ├── first-bot.md
│   │   └── configuration.md
│   │
│   ├── idea/                         # ✅ Already exists
│   │   ├── README.md
│   │   ├── 00-overview.md
│   │   └── ... (20 docs)
│   │
│   ├── full-missing-implementation/  # ✅ Already exists
│   │   ├── README.md
│   │   ├── 01-workers.md
│   │   └── ... (12 docs)
│   │
│   ├── api/
│   │   ├── orchestrator.md
│   │   ├── bot-manager.md
│   │   └── config-schema.md
│   │
│   └── guides/
│       ├── deploying.md
│       ├── scaling.md
│       └── debugging.md
```

**🔧 Create `docs/_config.yml`:**
```yaml
# Jekyll configuration for GitHub Pages
title: AI Assistants Army
description: Framework for building multi-bot AI systems
theme: jekyll-theme-cayman  # or: minima, slate, architect

# Optional: Use a remote theme for better design
# remote_theme: just-the-docs/just-the-docs

# Navigation
plugins:
  - jekyll-relative-links
  - jekyll-optional-front-matter
  - jekyll-readme-index
  - jekyll-titles-from-headings

# Markdown processing
markdown: kramdown
kramdown:
  input: GFM
  syntax_highlighter: rouge

# Include/exclude files
include:
  - README.md
  - CLAUDE.md
exclude:
  - node_modules/
  - package*.json
  - "*.test.js"
```

**📄 Create `docs/index.md`:**
```markdown
---
title: Home
layout: default
nav_order: 1
---

# AI Assistants Army

Framework for building multi-bot AI systems.

## 🚀 Quick Links

- [📖 Overview](idea/00-overview.md)
- [🎯 Getting Started](getting-started/)
- [🏗️ Architecture](idea/01-architecture.md)
- [📋 Missing Features](full-missing-implementation/)
- [🔧 API Reference](api/)

## What is AI Army?

A **framework for building multi-bot AI systems**, like **Ruby on Rails for AI bots**.

[Read the full overview →](idea/00-overview.md)
```

**⚙️ Repository Settings:**
```
1. Go to: Settings → Pages
2. Source: Deploy from a branch
3. Branch: main
4. Folder: /docs
5. Save

GitHub will automatically build and deploy:
https://developerz-ai.github.io/ai-army/
```

### Option 2: Docsify (No Build Step)

**How it works:**
```
Single HTML file + JavaScript
   ↓
Renders markdown client-side
   ↓
No build process needed
   ↓
Fast and simple
```

**📁 Structure:**
```
docs/
├── index.html              # 🆕 Docsify entry point
├── _sidebar.md             # 🆕 Navigation
├── _navbar.md              # 🆕 Top menu
├── README.md               # Home page content
├── idea/                   # ✅ Existing docs
└── full-missing-implementation/  # ✅ Existing docs
```

**📄 Create `docs/index.html`:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>AI Assistants Army</title>
  <meta name="description" content="Framework for multi-bot AI systems">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="//cdn.jsdelivr.net/npm/docsify@4/lib/themes/vue.css">
</head>
<body>
  <div id="app"></div>
  <script>
    window.$docsify = {
      name: 'AI Assistants Army',
      repo: 'developerz-ai/ai-army',
      loadSidebar: true,
      loadNavbar: true,
      subMaxLevel: 3,
      search: {
        paths: 'auto',
        placeholder: 'Search docs...'
      },
      plugins: [
        function(hook) {
          // Add "Edit on GitHub" link
          hook.beforeEach(function(html) {
            const url = 'https://github.com/developerz-ai/ai-army/blob/main/docs/';
            return html + `\n\n[📝 Edit this page](${url}${window.location.hash.replace('#/', '')})`
          })
        }
      ]
    }
  </script>
  <script src="//cdn.jsdelivr.net/npm/docsify@4"></script>
  <script src="//cdn.jsdelivr.net/npm/docsify/lib/plugins/search.min.js"></script>
  <script src="//cdn.jsdelivr.net/npm/prismjs@1/components/prism-bash.min.js"></script>
  <script src="//cdn.jsdelivr.net/npm/prismjs@1/components/prism-javascript.min.js"></script>
  <script src="//cdn.jsdelivr.net/npm/prismjs@1/components/prism-json.min.js"></script>
</body>
</html>
```

**📄 Create `docs/_sidebar.md`:**
```markdown
- [Home](/)

- **Getting Started**
  - [Installation](getting-started/installation.md)
  - [First Bot](getting-started/first-bot.md)
  - [Configuration](getting-started/configuration.md)

- **Idea Docs**
  - [Overview](idea/00-overview.md)
  - [Architecture](idea/01-architecture.md)
  - [Configuration](idea/02-configuration.md)
  - [All Docs →](idea/README.md)

- **Missing Implementation**
  - [Overview](full-missing-implementation/README.md)
  - [Workers](full-missing-implementation/01-workers.md)
  - [MCP](full-missing-implementation/02-mcp.md)
  - [All Missing →](full-missing-implementation/README.md)

- **API Reference**
  - [Orchestrator](api/orchestrator.md)
  - [BotManager](api/bot-manager.md)

- **Guides**
  - [Deploying](guides/deploying.md)
  - [Scaling](guides/scaling.md)
```

**⚙️ Repository Settings (same as Option 1):**
```
Settings → Pages → Deploy from /docs → Save
```

### Option 3: MkDocs (Python-based)

**Best for:** Large documentation projects with complex navigation

**How it works:**
```
Python tool that converts markdown → static site
   ↓
Custom themes (Material theme is popular)
   ↓
Build locally, commit dist/
   ↓
Deploy to GitHub Pages
```

**Not recommended** for ai-army since we want minimal build steps.

---

## 🚀 Recommended Approach

### Use **Docsify** (Option 2)

**Why:**
- ✅ No build step (just add index.html)
- ✅ Existing .md files work as-is
- ✅ Full-text search built-in
- ✅ Sidebar navigation
- ✅ Syntax highlighting
- ✅ GitHub integration
- ✅ Mobile-friendly
- ✅ Fast and lightweight

**Implementation Steps:**

1. **Create `docs/index.html`** (see above)
2. **Create `docs/_sidebar.md`** (see above)
3. **Create `docs/_navbar.md`:**
   ```markdown
   - [🏠 Home](/)
   - [📖 Docs](idea/)
   - [🔧 API](api/)
   - [💻 GitHub](https://github.com/developerz-ai/ai-army)
   ```

4. **Test locally:**
   ```bash
   cd docs
   npx docsify-cli serve
   # Opens at http://localhost:3000
   ```

5. **Enable GitHub Pages:**
   - Settings → Pages
   - Source: Deploy from branch
   - Branch: main, Folder: /docs
   - Save

6. **Done!** Site lives at:
   ```
   https://developerz-ai.github.io/ai-army/
   ```

---

## 📁 Updated Docs Structure

**Organize existing docs:**
```
docs/
├── index.html                    # 🆕 Docsify entry
├── _sidebar.md                   # 🆕 Navigation
├── _navbar.md                    # 🆕 Top menu
├── README.md                     # 🔧 Home page content
│
├── getting-started/              # 🆕 New section
│   ├── installation.md
│   ├── first-bot.md
│   ├── configuration.md
│   └── troubleshooting.md
│
├── idea/                         # ✅ Existing (20 docs)
│   ├── README.md
│   ├── 00-overview.md
│   ├── 01-architecture.md
│   └── ... (rest of idea docs)
│
├── full-missing-implementation/  # ✅ Existing (13 docs)
│   ├── README.md
│   ├── 01-workers.md
│   ├── 02-mcp.md
│   └── ... (rest of missing docs)
│
├── api/                          # 🆕 API reference
│   ├── README.md
│   ├── orchestrator.md
│   ├── bot-manager.md
│   ├── session-manager.md
│   ├── config-loader.md
│   └── adapters.md
│
├── guides/                       # 🆕 How-to guides
│   ├── README.md
│   ├── deploying.md
│   ├── scaling.md
│   ├── debugging.md
│   ├── security.md
│   └── contributing.md
│
└── assets/                       # 🆕 Images/diagrams
    ├── architecture.png
    ├── bot-lifecycle.png
    └── screenshots/
```

---

## 🎨 Docsify Customization

**Custom theme colors in `docs/index.html`:**
```html
<style>
  :root {
    --theme-color: #00f0ff;  /* Cyan accent */
    --theme-color-dark: #0a0a0f;  /* Dark bg */
    --base-background-color: #0a0a0f;
    --base-color: #b4b4b4;
  }
</style>
```

**Add plugins:**
```html
<!-- Copy to clipboard -->
<script src="//cdn.jsdelivr.net/npm/docsify-copy-code@2"></script>

<!-- Pagination -->
<script src="//cdn.jsdelivr.net/npm/docsify-pagination@2"></script>

<!-- Tabs -->
<script src="//cdn.jsdelivr.net/npm/docsify-tabs@1"></script>
```

---

## 🔗 Link Updates

**Update README.md links:**
```markdown
# AI Assistants Army

[📖 **Documentation**](https://developerz-ai.github.io/ai-army/) •
[🚀 **Demo**](https://developerz-ai.github.io/ai-army/demo) •
[💻 **GitHub**](https://github.com/developerz-ai/ai-army)

## Documentation

Full documentation is available at:
**https://developerz-ai.github.io/ai-army/**

- [Overview](https://developerz-ai.github.io/ai-army/#/idea/00-overview)
- [Architecture](https://developerz-ai.github.io/ai-army/#/idea/01-architecture)
- [Getting Started](https://developerz-ai.github.io/ai-army/#/getting-started/)
- [Missing Features](https://developerz-ai.github.io/ai-army/#/full-missing-implementation/)
```

---

## ✅ Benefits

**After setup:**

✅ **Professional Documentation**
- Clean, searchable site
- Mobile-friendly
- Automatic navigation
- Syntax highlighting

✅ **Zero Maintenance**
- No build step
- Edit markdown directly
- Instant updates on push
- GitHub handles hosting

✅ **Developer-Friendly**
- Edit in any editor
- Preview locally with `npx docsify-cli serve`
- Commit and push
- Auto-deploys

✅ **User-Friendly**
- Fast loading
- Full-text search
- Easy navigation
- Mobile responsive

---

## 📦 Summary

**Files to Create:**
```
docs/
├── index.html       # Docsify entry point (1 file, ~50 lines)
├── _sidebar.md      # Navigation menu (~30 lines)
├── _navbar.md       # Top menu (~5 lines)
└── README.md        # Home page content (enhance existing)
```

**Repository Settings:**
```
Enable GitHub Pages from /docs folder
```

**Result:**
```
https://developerz-ai.github.io/ai-army/
```

**Effort:** ~30 minutes to set up, zero maintenance after that.
