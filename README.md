# coding-agent-hub

MCP server that exposes coding agent CLIs (Claude, Gemini, Codex, OpenCode, Copilot, Cursor) as tools. Any MCP client can use it to invoke any coding agent.

## Why use this?

- **Multi-agent from any client** — Give Claude access to Gemini, Codex, OpenCode, Copilot, and Cursor, or give any MCP client access to all six. One config line, six agents.
- **Session continuity** — Multi-turn conversations with automatic context management. Start a session, send messages, get coherent multi-step responses.
- **No lock-in** — MIT license, 2 runtime dependencies, works with any MCP-compatible client. Swap backends without changing your workflow.
- **Production ready** — Structured error classification, stdin-based prompt delivery (no ARG_MAX limits), preflight checks, configurable timeouts, and 92%+ test coverage.

## Quick Start

```bash
npx coding-agent-hub
```

That's it. Your MCP client now has access to `claude-agent`, `gemini-agent`, `codex-agent`, `opencode-agent`, `copilot-agent`, and `cursor-agent` tools.

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

Each backend exposes a `<name>-agent` tool:

```
claude-agent     — Invoke Claude Code
gemini-agent     — Invoke Gemini CLI
codex-agent      — Invoke Codex CLI
opencode-agent   — Invoke OpenCode
copilot-agent    — Invoke GitHub Copilot CLI
cursor-agent     — Invoke Cursor CLI
```

Parameters: `prompt` (required), `model`, `workingDir`, `timeoutMs`, `sessionId`

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
| `session-manager.ts` | Multi-turn session state, history trimming |
| `config.ts` | File + CLI config loading |
| `preflight.ts` | Startup CLI/auth validation |
| `logger.ts` | Structured JSON logging to stderr |

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

## Programmatic Usage

```typescript
import { createHubServer } from 'coding-agent-hub';
import { DEFAULT_BACKENDS } from 'coding-agent-hub/backends';

const server = createHubServer(DEFAULT_BACKENDS);
```

## Development

```bash
pnpm install
pnpm test        # Run tests (263 tests)
pnpm test:e2e    # Run e2e tests (requires CLIs + auth)
pnpm typecheck   # Type check
pnpm build       # Build to dist/
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT
