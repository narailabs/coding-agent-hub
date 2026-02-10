# coding-agent-hub

MCP server that exposes coding agent CLIs (Claude, Gemini, Codex) as tools. Any MCP client can use it to invoke any coding agent.

## Quick Start

```bash
# As a Claude Code MCP server
npx coding-agent-hub

# Only enable specific backends
npx coding-agent-hub --backends gemini,codex
```

## Claude Code Integration

Add to your `.claude/settings.json`:

```json
{
  "mcpServers": {
    "coding-agent-hub": {
      "command": "npx",
      "args": ["coding-agent-hub"]
    }
  }
}
```

This gives Claude Code access to `gemini-agent`, `codex-agent`, and `claude-agent` tools.

## Supported Backends

| Backend | CLI Command | Default Model | Auth Env Var |
|---------|------------|---------------|--------------|
| Claude  | `claude`   | `claude-sonnet-4-5` | `ANTHROPIC_API_KEY` |
| Gemini  | `gemini`   | `gemini-2.5-pro` | `GEMINI_API_KEY` |
| Codex   | `codex`    | `codex-1` | `OPENAI_API_KEY` |

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
  "defaultTimeoutMs": 90000
}
```

## Programmatic Usage

```typescript
import { createHubServer } from 'coding-agent-hub';
import { DEFAULT_BACKENDS } from 'coding-agent-hub/types';

const server = createHubServer(DEFAULT_BACKENDS);
```

## License

MIT
