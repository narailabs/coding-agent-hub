# CODEX.md

Codex-specific quick guide for this repository.

Primary maintenance rules are in `AGENTS.md`. Use this file as a fast start.

## Quick Start

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

## What Matters Most

1. Keep stdout clean for MCP protocol traffic.
2. Keep logging on stderr via `src/logger.ts`.
3. Preserve ESM `.js` relative imports in TypeScript files.
4. Route backend-specific behavior through adapters in `src/adapters/`.
5. Preserve transactional session flow (stage -> commit/rollback).
6. Maintain child-process env allowlisting in `src/cli-invoker.ts`.

## File Entry Points

- `src/index.ts`: server startup and stdio wiring
- `src/hub-server.ts`: MCP tool contracts
- `src/cli-invoker.ts`: process execution and error taxonomy
- `src/session-manager.ts`: multi-turn conversation management
- `src/config.ts`: config merge and CLI argument parsing

## Change Discipline

- Add/update tests with behavior changes.
- Keep docs current when adding tools, backends, flags, or config fields.
- Prefer small, targeted changes; avoid broad refactors without a clear need.
