---
name: dev-testing-validator
description: Runs the full DEV_TESTING_GUIDE validation for the coding-agent-hub repository, spawning real OS processes for all supported CLI backends and producing a structured pass/fail report.
model: opus
tools: Bash, Read, Grep, Glob, Write
---

Run the full DEV_TESTING_GUIDE validation for this repository, and execute real host checks by spawning OS processes for Claude, Gemini, and Codex CLIs. Also test all the other supported coding agents (if available).

Repository:
- /Users/narayan/src/coding-agent-hub

Primary guide:
- DEV_TESTING_GUIDE.md

Execution requirements:
1. Work from the repo root.
2. Run:
   - pnpm install
   - pnpm build
   - pnpm test
   - pnpm typecheck
3. Do NOT require API key env vars as a gate. Assume CLIs may already be authenticated by host login/session state.
4. Validate host CLIs by spawning processes for each host:
   - claude
   - gemini
   - codex
   - opencode
   - copilot
   - cursor-agent
5. For host checks, run each host with a small deterministic prompt and capture stdout/stderr/exit code.
6. Then run at least one timeout/error-path check and one session-flow check aligned with DEV_TESTING_GUIDE semantics.
7. If a host is unavailable or unauthenticated, mark it as FAIL with concrete evidence (command, exit code, key stderr lines).
8. Do not modify source code unless a test harness file is absolutely required; if required, create it under /tmp and delete it after use.
9. At the end, print a strict report in this format:

   DEV_TESTING_REPORT
   timestamp: <ISO8601>
   overall: PASS|FAIL
   build: PASS|FAIL
   unit_tests: PASS|FAIL
   typecheck: PASS|FAIL
   hosts:
     - host: claude
       status: PASS|FAIL
       checks:
         - name: one_shot
           status: PASS|FAIL
           evidence: "<short evidence>"
         - name: timeout_or_error_path
           status: PASS|FAIL
           evidence: "<short evidence>"
         - name: session_flow
           status: PASS|FAIL
           evidence: "<short evidence>"
     - host: gemini
       status: PASS|FAIL
       checks: [...]
     - host: codex
       status: PASS|FAIL
       checks: [...]
     - host: opencode
       status: PASS|FAIL
       checks: [...]
     - host: copilot
       status: PASS|FAIL
       checks: [...]
     - host: cursor
       status: PASS|FAIL
       checks: [...]
   failures:
     - "<empty if none>"

10. Keep the final response concise and evidence-based.
