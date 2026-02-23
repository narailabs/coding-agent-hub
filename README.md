# coding-agent-hub

MCP server that exposes coding agent CLIs (Claude, Gemini, Codex, OpenCode, Copilot, Cursor) as tools. Any MCP client can use it to invoke any coding agent.

## Why use this?

- **Multi-agent from any client** — Give Claude access to Gemini, Codex, OpenCode, Copilot, and Cursor, or give any MCP client access to all six. One config line, six agents.
- **Session continuity** — Multi-turn conversations with automatic context management. Start a session, send messages, get coherent multi-step responses.
- **No lock-in** — MIT license, 2 runtime dependencies, works with any MCP-compatible client. Swap backends without changing your workflow.
- **Production ready** — Structured error classification, stdin-based prompt delivery (no ARG_MAX limits), preflight checks, configurable timeouts, and 92%+ test coverage.

## Installation

### As a standalone MCP server (recommended)

No install needed — just run it:

```bash
npx coding-agent-hub
```

### As a global CLI

```bash
npm install -g coding-agent-hub
coding-agent-hub
```

### As a library dependency

```bash
npm install coding-agent-hub
```

```typescript
import { createHubServer } from 'coding-agent-hub';
```

See [Programmatic Usage](#programmatic-usage) below for details.

## Quick Start

```bash
npx coding-agent-hub
```

That's it. Your MCP client now has access to `hub-agent` plus session tools (`hub-session-start`, `hub-session-message`, `hub-session-stop`, `hub-session-list`).

```bash
# Only enable specific backends
npx coding-agent-hub --backends gemini,codex
```

## MCP Client Integration

### Claude Code

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "coding-agent-hub": {
      "type": "stdio",
      "command": "npx",
      "args": ["coding-agent-hub"]
    }
  }
}
```

### Other MCP Clients

Any client that supports the MCP stdio transport can use coding-agent-hub. Point it at `npx coding-agent-hub` as the server command.

## Supported Backends

| Backend | CLI | Default Model | Auth Env Var |
|---------|-----|---------------|--------------|
| Claude   | `claude`       | `claude-sonnet-4-5`   | `ANTHROPIC_API_KEY` |
| Gemini   | `gemini`       | `gemini-2.5-pro`      | `GEMINI_API_KEY`    |
| Codex    | `codex`        | `gpt-5.3-codex-spark` | `OPENAI_API_KEY`    |
| OpenCode | `opencode`     | `claude-sonnet-4-5`   | `ANTHROPIC_API_KEY` |
| Copilot  | `copilot`      | `claude-sonnet-4-5`   | `GITHUB_TOKEN`      |
| Cursor   | `cursor-agent` | `claude-sonnet-4-5`   | `CURSOR_API_KEY`    |

Each backend requires its CLI to be installed and its API key to be set. The hub runs preflight checks at startup and logs warnings for missing CLIs or keys.

## Tools

### One-shot tools

One tool handles all backends:

```
hub-agent        — Invoke the selected backend (`claude`, `gemini`, `codex`, `opencode`, `copilot`, `cursor`)
```

Parameters: `backend` (required unless `sessionId` is provided), `prompt` (required), `model`, `workingDir`, `timeoutMs`, `sessionId`

### Session tools

For multi-turn conversations with context continuity:

```
hub-session-start   — Start a session (returns sessionId)
hub-session-message — Send a message in a session
hub-session-stop    — End a session
hub-session-list    — List active sessions
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    MCP Client                       │
│            (Claude Code, etc.)                      │
└──────────────────────┬──────────────────────────────┘
                       │ MCP stdio
┌──────────────────────▼──────────────────────────────┐
│               coding-agent-hub                      │
│                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │  Hub Server  │  │   Session    │  │ Preflight │  │
│  │  (MCP tools) │  │   Manager    │  │  Checks   │  │
│  └──────┬──────┘  └──────────────┘  └───────────┘  │
│         │                                           │
│  ┌──────▼──────┐                                    │
│  │ CLI Invoker │ ← Backend Adapters                              │
│  └──┬────┬───┬─┘   (claude, gemini, codex, opencode, copilot,   │
└─────┼────┼───┼──────  cursor, generic)                           │
      │    │   │
      ▼    ▼   ▼
   claude gemini codex opencode copilot cursor  (child processes)
```

**Key modules:**

| Module | Purpose |
|--------|---------|
| `hub-server.ts` | MCP server, tool registration |
| `cli-invoker.ts` | Spawns CLI processes, collects output |
| `adapters/` | Backend-specific arg building and response extraction |
| `plugins/` | Plugin runtime, capability probing, and continuity strategy |
| `session-manager.ts` | Multi-turn session state, history trimming |
| `session-store.ts` | Optional file persistence for active sessions |
| `config.ts` | File + CLI config loading |
| `preflight.ts` | Startup CLI/auth validation |
| `logger.ts` | Structured JSON logging to stderr |

### Plugin system

`coding-agent-hub` uses `PluginRuntime` to decide whether a session should use
hub-managed history or backend-native continuation. Capabilities are discovered
from each backend's `--version` and `--help` output and cached for reuse.

- Built-in plugins cover default backends (`claude`, `gemini`, `codex`, `opencode`,
  `copilot`, `cursor`, `generic`).
- A backend can pin a plugin explicitly via `backend.plugin`.
- Custom plugins can be loaded from `plugins.paths` in config.
- `codex` currently uses `exec resume` for continuation when native mode is active.

Example:

```json
{
  "plugins": {
    "paths": ["./plugins/custom.plugin.mjs"],
    "strict": false,
    "capabilityCacheTtlMs": 120000
  }
}
```

### Session persistence

Set `sessionPersistence: true` to keep active sessions on disk:

- Stored under `~/.coding-agent-hub/sessions`
- Session metadata includes `pluginId`, `continuityMode`, and `capabilitySnapshot`
- `hub-session-list` returns restored sessions after restart

## Configuration

Create `~/.coding-agent-hub/config.json`:

```json
{
  "backends": {
    "gemini": {
      "defaultModel": "gemini-2.0-flash",
      "timeoutMs": 60000
    }
  },
  "defaultTimeoutMs": 90000,
  "sessionPersistence": true
}
```

### CLI flags

```
--config <path>          Config file path (default: ~/.coding-agent-hub/config.json)
--backends <list>        Comma-separated backends to enable (e.g., gemini,codex)
--session-timeout <ms>   Session idle timeout in milliseconds (default: 1800000)
```

`plugins` and plugin metadata options are loaded from config only:

```json
{
  "sessionPersistence": true,
  "plugins": {
    "paths": ["./plugins/custom.plugin.mjs"],
    "strict": true,
    "capabilityCacheTtlMs": 120000
  }
}
```

### Custom backends

Add any CLI as a backend:

```json
{
  "backends": {
    "aider": {
      "displayName": "Aider",
      "command": "aider",
      "defaultModel": "gpt-4",
      "authEnvVar": "OPENAI_API_KEY",
      "argBuilder": "generic"
    }
  }
}
```

You can pin a backend to a plugin when needed:

```json
{
  "backends": {
    "codex": {
      "plugin": "codex"
    }
  }
}
```

## Programmatic Usage

```typescript
import { createHubServer } from 'coding-agent-hub';
import { DEFAULT_BACKENDS } from 'coding-agent-hub/backends';

const server = createHubServer(DEFAULT_BACKENDS);
```

## Development

```bash
pnpm install
pnpm test        # Run all unit tests
pnpm test:e2e    # Run e2e tests (requires CLIs + auth)
pnpm typecheck   # Type check
pnpm build       # Build to dist/
```

### Runtime scripts

- `pnpm verify:agents` runs `scripts/verify-agent-params.ts` to probe CLI capabilities and continuity mode compatibility.
- `pnpm check:upstream-versions` runs `scripts/check-upstream-versions.ts` to report baseline vs published version drift.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT
