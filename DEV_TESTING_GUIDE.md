# Dev Testing Guide — Coding Agent Hub

A hands-on guide to build, install, and test all Coding Agent Hub functionality using Claude Code as the MCP client.

---

## Prerequisites

### Required CLIs

You need at least one of these agent CLIs installed and authenticated:

| CLI | Install | Auth |
|-----|---------|------|
| Claude Code | `npm install -g @anthropic-ai/claude-code` | `claude login` or set `ANTHROPIC_API_KEY` |
| Gemini CLI | `npm install -g @anthropic-ai/claude-code` *(bundled)* / `npm install -g @anthropic-ai/gemini-cli` | Set `GEMINI_API_KEY` |
| Codex CLI | `npm install -g @openai/codex` | Set `OPENAI_API_KEY` |
| OpenCode CLI | Install OpenCode CLI (`opencode`) | One of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or another provider key configured for OpenCode |
| Copilot CLI | Install Copilot CLI (`copilot`) | Set `GITHUB_TOKEN` |
| Cursor CLI | Install Cursor CLI (`cursor-agent`) | Set `CURSOR_API_KEY` |

Check what you have:

```bash
claude --version   # e.g. 2.1.44
gemini --version   # e.g. 0.30.0-nightly
codex --version    # e.g. codex-cli 0.101.0
opencode --version # e.g. opencode vX.Y.Z
copilot --version  # e.g. copilot X.Y.Z
cursor-agent --version # e.g. cursor-agent X.Y.Z
```

### Required tools

```bash
node --version   # >= 18
pnpm --version   # any recent version
```

---

## Codex Automation Prompt (New)

For Codex scheduled automations, use the prompt in:

`/Users/narayan/src/coding-agent-hub/prompts/dev-testing-automation-prompt.md`

That prompt is designed to:

- Run the DEV guide checks end-to-end
- Spawn OS processes for Claude/Gemini/Codex host validation
- Avoid API-key hard requirements (assumes host CLIs are already authenticated via login/session)
- Produce a structured pass/fail report suitable for automation runs

---

## Part 1 — Build and Unit Tests

### 1.1 Clone and build

```bash
git clone <repo-url> coding-agent-hub
cd coding-agent-hub
pnpm install
pnpm build
```

### 1.2 Run unit tests

```bash
pnpm test
```

Expected: all unit tests pass (`pnpm test`).

### 1.3 Type check

```bash
pnpm typecheck
```

Should exit cleanly with no errors.

### 1.4 Runtime scripts

```bash
pnpm verify:agents
pnpm check:upstream-versions
```

- `pnpm verify:agents`: probe each configured backend with `--version`/`--help` and validate plugin-derived continuity expectations.
- `pnpm check:upstream-versions`: fetch upstream CLI version baselines and report drift from checked-in minimums.

---

## Part 2 — Install as Claude Code MCP Server

There are two ways to install: **local dev** (recommended for testing) or **npx** (for production).

### Option A: Local dev install (recommended)

This links your local build so changes are reflected immediately after `pnpm build`.

**Step 1 — Add to `.mcp.json`**

Create or edit `.mcp.json` in the project root (or `~/.claude/.mcp.json` for user-wide config):

```json
{
  "mcpServers": {
    "coding-agent-hub": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/coding-agent-hub/dist/index.js"]
    }
  }
}
```

Replace `/absolute/path/to/coding-agent-hub` with the actual path. For example:

```json
{
  "mcpServers": {
    "coding-agent-hub": {
      "type": "stdio",
      "command": "node",
      "args": ["/Users/narayan/src/coding-agent-hub/dist/index.js"]
    }
  }
}
```

**Step 2 — Rebuild after changes**

After editing source code:

```bash
pnpm build
```

Then restart Claude Code (or start a new conversation) to pick up the change.

### Option B: npx install

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

### Option C: Restrict to specific backends

Only enable Gemini and Codex (exclude Claude to avoid recursion):

```json
{
  "mcpServers": {
    "coding-agent-hub": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/absolute/path/to/coding-agent-hub/dist/index.js",
        "--backends",
        "gemini,codex"
      ]
    }
  }
}
```

### Verify installation

Start Claude Code and run:

```
/mcp
```

You should see `coding-agent-hub` listed with these tools:
- `hub-agent`
- `hub-session-start`
- `hub-session-message`
- `hub-session-stop`
- `hub-session-list`

---

## Part 3 — Testing One-Shot Agent Tools

These tools invoke a single CLI call and return the result. No session state.

### 3.1 Test `hub-agent` with Gemini backend

In Claude Code, type:

```
Use the hub-agent tool with backend "gemini" to answer: "What is the capital of France?"
```

**What to verify:**
- Tool call succeeds
- Response contains "Paris"
- Metadata footer shows: `Backend: gemini | Model: gemini-2.5-pro | Duration: XXXms`

### 3.2 Test `hub-agent` with Codex backend

```
Use the hub-agent tool with backend "codex" to answer: "Write a Python function that checks if a number is prime"
```

**What to verify:**
- Tool call succeeds
- Response contains a Python function
- Metadata footer shows: `Backend: codex | Model: gpt-5.3-codex-spark | Duration: XXXms`

### 3.3 Test `hub-agent` with Claude backend

```
Use the hub-agent tool with backend "claude" to answer: "Explain the difference between a stack and a queue in one paragraph"
```

**What to verify:**
- Tool call succeeds
- Response explains both data structures
- Metadata footer shows: `Backend: claude | Model: claude-sonnet-4-5 | Duration: XXXms`

> **Note:** Using `hub-agent` with backend `claude` from within Claude Code means Claude is invoking another Claude instance via the CLI. This works but is recursive — keep prompts simple.

### 3.4 Test `hub-agent` with OpenCode backend

```
Use the hub-agent tool with backend "opencode" to answer: "What is 2+2? Reply with only the number."
```

**What to verify:**
- Tool call succeeds
- Response contains `4`
- Metadata footer shows: `Backend: opencode | ...`

### 3.5 Test `hub-agent` with Copilot backend

```
Use the hub-agent tool with backend "copilot" to answer: "Name one advantage of unit testing in one sentence."
```

**What to verify:**
- Tool call succeeds
- Response is short and coherent
- Metadata footer shows: `Backend: copilot | ...`

### 3.6 Test `hub-agent` with Cursor backend

```
Use the hub-agent tool with backend "cursor" to answer: "Give a one-line definition of idempotency."
```

**What to verify:**
- Tool call succeeds
- Response contains a correct one-line definition
- Metadata footer shows: `Backend: cursor | ...`

### 3.7 Test model override

```
Use the hub-agent tool with backend "gemini" and model "gemini-2.0-flash" to answer: "What is 2+2?"
```

**What to verify:**
- Metadata footer shows `Model: gemini-2.0-flash` (not the default)

### 3.8 Test working directory

```
Use the hub-agent tool with backend "codex" and workingDir set to "/tmp" to answer: "List the files in the current directory"
```

**What to verify:**
- The agent operates in `/tmp`, not your project directory

### 3.9 Test timeout

```
Use the hub-agent tool with backend "gemini" and timeoutMs set to 1000 to answer: "Write a 5000 word essay about the history of computing"
```

**What to verify:**
- Should fail with a timeout error (1 second is too short for a long response)
- Error message mentions timeout

### 3.10 Test error handling — invalid backend

If you restricted backends with `--backends gemini,codex`, call `hub-agent` with backend `"claude"`. It should fail with unknown/disabled backend.

---

## Part 4 — Testing Session Tools (Multi-Turn Conversations)

Sessions let you have multi-turn conversations with a backend, where history is preserved across calls.

### 4.1 Start a session with a custom ID

```
Use the hub-session-start tool with backend "gemini" and sessionId "my-test-session"
```

**What to verify:**
- Returns JSON with `sessionId: "my-test-session"`, `backend`, and `model`
- The `sessionId` matches the one you provided

### 4.1b Start a session with auto-generated ID

```
Use the hub-session-start tool to start a session with the "gemini" backend
```

**What to verify:**
- Returns JSON with a UUID `sessionId`, `backend`, and `model`
- Note the `sessionId` — you'll need it for subsequent calls

### 4.2 Send first message

```
Use the hub-session-message tool with the session ID from above, and send: "My name is Alice. Remember it."
```

**What to verify:**
- Response acknowledges the name
- Metadata footer includes `Session: <session-id>`

### 4.3 Send follow-up message (tests context continuity)

```
Use the hub-session-message tool with the same session ID, and send: "What is my name?"
```

**What to verify:**
- Response says "Alice" — proving conversation history was sent
- This is the key test: without sessions, the agent wouldn't know the name

### 4.4 List sessions

```
Use the hub-session-list tool
```

**What to verify:**
- Shows the active session with correct `backend`, `model`, `turnCount` (should be 4 — 2 user + 2 assistant turns)

### 4.4b Plugin continuity fields on session start

```bash
Use the hub-session-start tool with backend "codex"
```

**What to verify:**
- Response includes `pluginId` and `continuityMode`.
- `pluginId` matches a known plugin name (for example `codex`).
- `continuityMode` is either `native` or `hub`, based on plugin probe results.

### 4.5 Stop a session

```
Use the hub-session-stop tool with the session ID
```

**What to verify:**
- Returns `Session <id> stopped`

### 4.6 Verify session is gone

```
Use the hub-session-list tool
```

**What to verify:**
- The stopped session no longer appears

### 4.7 Test duplicate session ID

```
Use the hub-session-start tool with backend "gemini" and sessionId "my-test-session"
```

Then try to start another session with the same ID:

```
Use the hub-session-start tool with backend "gemini" and sessionId "my-test-session"
```

**What to verify:**
- Second call returns an error: `Session ID already exists: my-test-session`

### 4.8 Test invalid session ID

```
Use the hub-session-message tool with sessionId "nonexistent-id" and message "hello"
```

**What to verify:**
- Returns an error: `Session not found: nonexistent-id`

---

## Part 5 — Testing Configuration

### 5.1 Custom config file

Create `~/.coding-agent-hub/config.json`:

```bash
mkdir -p ~/.coding-agent-hub
cat > ~/.coding-agent-hub/config.json << 'EOF'
{
  "backends": {
    "gemini": {
      "defaultModel": "gemini-2.0-flash",
      "timeoutMs": 60000
    }
  },
  "defaultTimeoutMs": 90000
}
EOF
```

Restart Claude Code and test:

```
Use the hub-agent tool with backend "gemini" to answer: "Say hello"
```

**What to verify:**
- Metadata shows `Model: gemini-2.0-flash` (overridden default)

Clean up afterward:

```bash
rm ~/.coding-agent-hub/config.json
```

### 5.2 Backend filtering via CLI args

Update your `.mcp.json` to restrict backends:

```json
{
  "mcpServers": {
    "coding-agent-hub": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/absolute/path/to/coding-agent-hub/dist/index.js",
        "--backends",
        "gemini"
      ]
    }
  }
}
```

Restart Claude Code and run `/mcp`. `hub-agent` plus session tools should be listed. Then call `hub-agent` with backend `"claude"` or `"codex"` and verify it fails because those backends are disabled.

### 5.3 Session persistence with metadata

Set `sessionPersistence` to `true` in your config file (if not already set), then restart the MCP server:

```json
{
  "sessionPersistence": true
}
```

```bash
Use the hub-session-start tool with backend "codex" and sessionId "persistence-demo"
```

```bash
Use the hub-session-list tool
```

**What to verify:**
- `persistence-demo` is listed with `pluginId` and `continuityMode`.
- If you restart `coding-agent-hub` and repeat `hub-session-list`, the same session entry is still present (until idle timeout or manual stop).

---

## Part 6 — Testing Edge Cases

### 6.1 Empty/short response handling

The message extractor requires at least 10 characters. Test with:

```
Use the hub-agent tool with backend "gemini" to answer: "Reply with just the letter A"
```

**What to verify:**
- May return an extraction error since "A" is less than 10 chars — this is expected behavior

### 6.2 Large response

```
Use the hub-agent tool with backend "gemini" to answer: "List all countries in the world with their capitals"
```

**What to verify:**
- Large responses are handled without truncation (stdout buffer is 5MB)

### 6.3 Missing CLI binary

If you don't have `codex` installed, test:

```
Use the hub-agent tool with backend "codex" to answer: "hello"
```

**What to verify:**
- Returns a clear error: `Failed to spawn codex: ...`

### 6.4 Session timeout configuration

Update `args` in your `.mcp.json`:

```json
"args": [
  "/absolute/path/to/coding-agent-hub/dist/index.js",
  "--session-timeout",
  "5000"
]
```

Start a session, wait 6 seconds, then try to send a message. The session should have been auto-cleaned.

---

## Part 7 — Testing All Six Default Backends Together

This is the full integration test — use all six default backends in a single conversation.

```
I want to compare how six different AI agents answer the same question.

Use hub-agent six times with backends "claude", "gemini", "codex", "opencode", "copilot", and "cursor" to each answer:
"What are the three most important principles of good software architecture?"

Then summarize the differences in their answers.
```

**What to verify:**
- All six tool calls succeed
- Each response is attributed to the correct backend
- Claude Code successfully orchestrates multiple agent calls

---

## Part 8 — Programmatic Usage (for library consumers)

If you're importing `coding-agent-hub` as a library:

```typescript
import { createHubServer } from 'coding-agent-hub';
import { DEFAULT_BACKENDS } from 'coding-agent-hub/backends';

// Create server with all backends
const server = createHubServer(DEFAULT_BACKENDS);

// Or filter to specific backends
const geminiOnly = DEFAULT_BACKENDS.map(b => ({
  ...b,
  enabled: b.name === 'gemini',
}));
const server2 = createHubServer(geminiOnly);
```

---

## Quick Reference — All MCP Tools

| Tool | Purpose | Key Params |
|------|---------|------------|
| `hub-agent` | One-shot call to selected backend | `backend`, `prompt`, `model?`, `workingDir?`, `timeoutMs?`, `sessionId?` |
| `hub-session-start` | Begin multi-turn session | `backend`, `model?`, `workingDir?`, `sessionId?` |
| `hub-session-message` | Send message in session | `sessionId`, `message`, `timeoutMs?` |
| `hub-session-stop` | End a session | `sessionId` |
| `hub-session-list` | List active sessions | *(none)* |

---

## Troubleshooting

### MCP server not showing up in `/mcp`

- Verify the path in `.mcp.json` is absolute and correct
- Run `node /path/to/dist/index.js --help` manually to confirm it works
- Check Claude Code logs for MCP server startup errors

### Tool call fails with "Failed to spawn"

- The CLI binary isn't in `PATH`
- Run `which claude`, `which gemini`, `which codex`, `which opencode`, `which copilot`, and `which cursor-agent` to verify
- The MCP server inherits a limited `PATH` — you may need to ensure the CLIs are on the system PATH

### Timeout errors

- Default timeout is 120 seconds per backend
- Complex prompts or slow models may need more time
- Override per-call with `timeoutMs` or globally in config

### Session not preserving context

- Verify you're using the same `sessionId` across calls
- Sessions auto-expire after 30 minutes of inactivity (configurable via `--session-timeout`)
- Check that `hub-session-list` shows your session as active
