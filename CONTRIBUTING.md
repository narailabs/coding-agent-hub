# Contributing to Coding Agent Hub

Thanks for your interest in contributing! This document covers how to get started.

## Development Setup

```bash
git clone https://github.com/narailabs/coding-agent-hub.git
cd coding-agent-hub
pnpm install
pnpm test
```

Requirements:
- Node.js >= 18
- pnpm

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add or update tests as needed
4. Run `pnpm test` and `pnpm typecheck` to verify
5. Open a pull request

## Code Style

- TypeScript strict mode
- ESM — all relative imports end in `.js`
- Minimal dependencies — avoid adding new runtime deps unless absolutely necessary
- Tests use Vitest

## Project Structure

```
src/
  index.ts           — CLI entry point
  hub-server.ts      — MCP server + tool registration
  cli-invoker.ts     — CLI process spawning
  config.ts          — Configuration loading
  backends.ts        — Default backend definitions
  types.ts           — Shared types
  message-extractor.ts — Stdout parsing
  session-manager.ts — Multi-turn sessions
  session-store.ts   — Session persistence
  preflight.ts       — Startup checks
  logger.ts          — Structured logging
  adapters/          — Backend-specific adapters
    types.ts
    claude-adapter.ts
    gemini-adapter.ts
    codex-adapter.ts
    generic-adapter.ts
    index.ts

tests/               — Vitest test files
```

## Adding a New Backend

1. Create `src/adapters/<name>-adapter.ts` implementing `BackendAdapter`
2. Register it in `src/adapters/index.ts`
3. Add a default config in `src/backends.ts` (or document it as config-only)
4. Add tests in `tests/adapters.test.ts`

The `BackendAdapter` interface:

```typescript
interface BackendAdapter {
  buildArgs(input: ToolInput, model: string): string[];
  extractResponse(stdout: string, exitCode: number | null): ExtractedMessage | null;
  buildDescription(config: BackendConfig): string;
  promptDelivery: 'arg' | 'stdin';
  buildArgsWithoutPrompt?(input: ToolInput, model: string): string[];
}
```

## Running Tests

```bash
pnpm test              # Run all tests
pnpm test -- --watch   # Watch mode
pnpm vitest run --coverage  # Coverage report
```

Current coverage: 92%+ across all modules.

## Commit Messages

Follow conventional commits:

```
feat: add new backend adapter for X
fix: handle timeout edge case in session manager
test: add coverage for adapter extraction
docs: update README with new config options
refactor: extract shared validation logic
```

## Reporting Issues

- Use GitHub Issues
- Include: what you expected, what happened, reproduction steps
- For backend-specific issues, include which CLI version you're using

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include tests for new functionality
- Update README if adding user-facing features
- All CI checks must pass before merge
