# CLAUDE.md - Coding Agent Hub

## Overview

Coding Agent Hub is a standalone MCP server that exposes coding agent CLIs (Claude, Gemini, Codex) as tools. Any MCP client can use it to invoke any coding agent.

## Build & Test

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

## Architecture

- `src/index.ts` — CLI entry point (stdio MCP server)
- `src/hub-server.ts` — MCP server creation + tool registration
- `src/cli-invoker.ts` — Spawns CLI agents as child processes
- `src/config.ts` — Configuration loading (file + env vars)
- `src/backends.ts` — Backend definitions + defaults
- `src/types.ts` — Shared types
- `src/message-extractor.ts` — Output parsing from CLI stdout

## Key Design Decisions

- Uses `@modelcontextprotocol/sdk` directly (no Claude Agent SDK dependency)
- All three backends (Claude, Gemini, Codex) are exposed — no self-exclusion
- Config lives at `~/.coding-agent-hub/config.json` or via env vars
- Stdio transport for Claude Code / MCP client integration

## ESM

All relative imports must end in `.js`.
