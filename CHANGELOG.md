# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-02-23

### Added
- OpenCode backend adapter — multi-provider coding agent with JSON response extraction
- Copilot CLI backend adapter — GitHub Copilot with ANSI code stripping
- Cursor CLI backend adapter — NDJSON-aware extraction with `--print`/`--force` flags
- E2E test infrastructure — vitest e2e config with CLI/auth skip helpers
- Structured error taxonomy — errors classified as `timeout`, `auth`, `spawn`, `parse`, `exit`, or `unknown` with `retryable` flag
- Stderr forwarding — stderr output captured and surfaced in success metadata as warnings
- Config validation — `--session-timeout` validated at parse time; custom backends checked for required fields
- Structured JSON logging to stderr via `HUB_LOG_LEVEL` env var
- Transactional session turns — failed CLI calls no longer leave orphaned user turns in history
- Semantic session trimming — preserves first and last N turns, removes from the middle with omission markers
- Backend adapter pattern — pluggable adapters for claude, gemini, codex, and generic backends
- Plugin runtime — resolves plugins, probes backend continuity capabilities, and applies subcommand/flag strategies per backend
- Session metadata persistence — sessions now persist `pluginId`, `continuityMode`, and `capabilitySnapshot` when `sessionPersistence` is enabled
- Stdin-based prompt delivery — avoids OS ARG_MAX limits for large prompts
- Preflight checks — validates CLI availability and auth config at startup
- Opt-in file-backed session persistence via `sessionPersistence: true` config
- Custom session IDs in `hub-session-start`

### Changed
- Default Codex model changed from `codex-1` to `gpt-5.3-codex-spark`
- Codex CLI invoked with `--skip-git-repo-check` flag
- One-shot MCP interface collapsed into a single `hub-agent` tool with a `backend` parameter (replacing per-backend `*-agent` tools)

## [0.1.0] - 2025-05-15

### Added
- Initial release
- MCP server exposing Claude, Gemini, and Codex as tools
- Per-backend agent tools (`claude-agent`, `gemini-agent`, `codex-agent`)
- Session lifecycle tools (`hub-session-start`, `hub-session-message`, `hub-session-stop`, `hub-session-list`)
- Multi-turn conversation context management
- Configurable backends via `~/.coding-agent-hub/config.json`
- CLI flags: `--config`, `--backends`, `--session-timeout`, `--help`
- Custom backend support via config
- Environment filtering for child processes
- Stdout collection with 5MB buffer limit
