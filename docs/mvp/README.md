# AI Army MVP - Implementation Phases

**Package**: `ai-army`
**PostgreSQL**: 18
**Philosophy**: SRP, SOLID, TESTED - every module has tests, hot reload support
**Demo**: `./demo` project like Rails for developers

---

## 📚 NEW: Library Helper Files!

**Before implementing any phase**, check the **[helpers/](./helpers/)** directory for library recommendations!

- Comprehensive guides for each technical area
- 16 carefully chosen production dependencies
- Implementation examples and best practices
- Why we chose each library (and why NOT alternatives)

**See**: [helpers/README.md](./helpers/README.md) for complete index

## Phases Overview

| Phase | Name | Focus | Files | Tests |
|-------|------|-------|-------|-------|
| 1 | Foundation | Config + Database | 5 | 5 unit |
| 2 | Docker Execution | Real bash in containers | 3 | 3 integration |
| 3 | Bot Lifecycle | Start/stop/reload | 4 | 4 unit |
| 4 | Channels | Slack + Discord | 4 | 4 integration |
| 5 | AI Agent | Vercel AI SDK + Tools | 5 | 5 integration |
| 6 | End-to-End | Complete message flow | 3 | 3 e2e |
| 7 | CLI Tools | Developer commands | 3 | 3 integration |
| 8 | Demo Project | ./demo with 3 bots | 8 | - |
| 9 | CI/CD | Automated testing | 2 | - |
| 10 | Hot Reload | nginx-style reload | 4 | 4 integration |

**Total**: ~40 implementation files, ~25 test files

## Build Order

Phases must be built sequentially (each depends on previous):

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6
                                                      ↓
                             Phase 10 ← Phase 9 ← Phase 8 ← Phase 7
```

## Success Criteria

### MVP Complete When:
- ✅ Bot loads from `config.json` with env var interpolation
- ✅ PostgreSQL 18 stores sessions and bot state
- ✅ Docker containers execute real bash commands
- ✅ Slack/Discord messages route to correct bot
- ✅ AI processes messages with tool calls
- ✅ `npx ai-army validate && npx ai-army reload` works (like nginx)
- ✅ `./demo` runs with one command
- ✅ All tests pass in CI

### Quality Standards:
- Every module < 300 lines
- Every module has test file in `test/`
- No TODOs in production code
- SRP, SOLID throughout

## Quick Links

- [Phase 1 - Foundation](./phase-1-foundation.md)
- [Phase 2 - Docker Execution](./phase-2-docker.md)
- [Phase 3 - Bot Lifecycle](./phase-3-lifecycle.md)
- [Phase 4 - Channels](./phase-4-channels.md)
- [Phase 5 - AI Agent](./phase-5-ai-agent.md)
- [Phase 6 - End-to-End](./phase-6-e2e.md)
- [Phase 7 - CLI Tools](./phase-7-cli.md)
- [Phase 8 - Demo Project](./phase-8-demo.md)
- [Phase 9 - CI/CD](./phase-9-cicd.md)
- [Phase 10 - Hot Reload](./phase-10-reload.md)
