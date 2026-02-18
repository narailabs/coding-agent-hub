# AGENTS.md

Repository operating guide for coding agents maintaining `coding-agent-hub`.

## Project Scope

`coding-agent-hub` is a standalone MCP stdio server that exposes coding agent CLIs as MCP tools:

- One-shot tools: `claude-agent`, `gemini-agent`, `codex-agent`, `opencode-agent`, `copilot-agent`, `cursor-agent`
- Session tools: `hub-session-start`, `hub-session-message`, `hub-session-stop`, `hub-session-list`

The hub is intentionally client-agnostic. Keep behavior compatible with any MCP client.

## Stack and Build

- Language: TypeScript (strict), ESM
- Runtime: Node.js >= 18
- Package manager: `pnpm`
- Core deps: `@modelcontextprotocol/sdk`, `zod`

Common commands:

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm test:e2e
```

`test:e2e` requires installed CLIs and valid auth env vars.

## Architecture Map

- `src/index.ts`: CLI entrypoint, config loading, preflight, stdio transport
- `src/hub-server.ts`: MCP server creation and tool registration
- `src/cli-invoker.ts`: child process spawn, timeout handling, stderr capture, error classification
- `src/adapters/`: per-backend arg building and output extraction
- `src/session-manager.ts`: multi-turn session state and transactional turn flow
- `src/session-store.ts`: optional file persistence (`~/.coding-agent-hub/sessions`)
- `src/config.ts`: config file parsing, CLI args, backend resolution
- `src/preflight.ts`: startup checks for CLI presence and auth env vars
- `src/logger.ts`: structured JSON logs to stderr

## Non-Negotiable Invariants

1. Stdout is protocol-only.
`@modelcontextprotocol/sdk` uses stdout for MCP messages. Do not add runtime logs to stdout.

2. Logs go to stderr in structured JSON.
Use `logger` (`src/logger.ts`), keep `HUB_LOG_LEVEL` behavior intact.

3. ESM import discipline.
All relative imports must use `.js` extension in TypeScript source.

4. Backend invocation model stays adapter-driven.
Do not inline backend-specific logic into `hub-server.ts` or `cli-invoker.ts`. Add/update adapters instead.

5. Session writes are transactional.
For sessioned calls, user turns are staged first, then committed on success or rolled back on failure. Do not leave pending/orphaned turns.

6. Child env is allowlisted.
Keep the filtered env model in `src/cli-invoker.ts`; do not pass full `process.env` to child CLIs.

## Backend Extension Checklist

When adding a backend:

1. Add adapter: `src/adapters/<name>-adapter.ts`
2. Register adapter: `src/adapters/index.ts`
3. Add default config: `src/backends.ts` (if default-enabled)
4. Ensure config support: `argBuilder` type in `src/types.ts`
5. Add/update tests: `tests/adapters.test.ts`, and affected hub/invoker/config tests
6. Update docs: `README.md`, `CHANGELOG.md` (and `DEV_TESTING_GUIDE.md` if needed)

## Testing Guidance

- Always run at least:
  - `pnpm test`
  - `pnpm typecheck`
- If behavior or contracts changed, also run:
  - `pnpm build`
- If CLI integration or adapter behavior changed, run:
  - `pnpm test:e2e` (when local environment supports it)

Prefer targeted Vitest runs while iterating, then run full test suite before finalizing.

## Config and UX Expectations

- Default config path: `~/.coding-agent-hub/config.json`
- `--backends` must only toggle backend enablement, not rewrite backend definitions
- Invalid custom backend configs should fail gracefully with warnings
- Tool errors should remain user-readable and include backend/exit/error type context

## Dependency Policy

Keep runtime dependencies minimal. Avoid adding new runtime packages unless there is a clear architectural need.
