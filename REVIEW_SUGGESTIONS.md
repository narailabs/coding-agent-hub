# Code Review — Suggestions and Issues

## Critical

### Build is broken — missing `node_modules`

`pnpm install` needs to be run. The `@types/node` dependency is declared in
`devDependencies` but not installed, causing 20+ TypeScript compilation errors
across multiple files (`Cannot find module 'node:child_process'`,
`Cannot find name 'process'`, `Cannot find name 'Buffer'`, etc.).

**Fix:** Run `pnpm install`.

## High

### Implicit `any` types cause strict-mode compilation errors

With `strict: true` in tsconfig.json, several parameters lack type annotations:

| File | Line(s) | Issue |
|------|---------|-------|
| `src/plugins/cli-probe.ts` | 19 | `execFile` callback params `error`, `stdout`, `stderr` are implicitly `any` |
| `src/session-store.ts` | 82–83 | `.filter(f => ...)` / `.map(f => ...)` params are implicitly `any` |
| `src/hub-server.ts` | tool handlers | `args` parameters lack type annotations |

**Fix:** Add explicit types. For hub-server tool handlers, use `z.infer<typeof schema>` to derive types from the Zod schemas.

## Medium

### 10-character minimum silently drops valid short responses

**File:** `src/message-extractor.ts:38,55,83`

Responses shorter than 10 characters are silently rejected (`return null`).
This drops valid outputs like `"Yes"`, `"No"`, `"42"`, or JSON
`{"response":"OK"}`.

**Fix:** Replace the 10-char minimum with a simple non-empty check, or reduce to
1 character.

### `trimByChars` has O(n²) complexity

**File:** `src/session-manager.ts:523–540`

The `while` loop calls `committedCount()` and recomputes `committedIndices`
every iteration. Both scan the full array each time.

**Fix:** Compute committed indices once, remove from the pre-built list as turns
are spliced.

### No validation on `invokeCli` parameters

**File:** `src/cli-invoker.ts:77`

`timeoutMs` can be 0, negative, or excessively large. `workingDir` is not
validated. The Zod schemas in hub-server.ts also lack range constraints for
`timeoutMs`.

**Fix:** Add `z.number().int().min(1000).max(600000)` to the schema, and add a
guard in `invokeCli` (e.g., clamp to a sane default).

### Auth error detection via string matching is fragile

**File:** `src/cli-invoker.ts:15,183–184`

Patterns like `/401/i` and `/403/i` match any stderr containing those numbers,
including URLs or unrelated text (e.g., "processed 401 items").

**Fix:** Move error classification into each adapter via a `classifyError()`
method, so backend-specific patterns can be used.

## Low

### `stdin.write()` / `stdin.end()` lack error handling

**File:** `src/cli-invoker.ts:210–213`

If the child process exits immediately, writing to stdin can emit an error. Not
handled.

**Fix:** Wrap in try-catch or listen for `'error'` on `child.stdin`.

### Magic numbers scattered throughout

Various hardcoded values should be named constants:

- `10` — keepTail count in session trimming (session-manager.ts:481)
- `5 * 1024 * 1024` — stdout buffer limit (message-extractor.ts:11)
- `10` — minimum response length (message-extractor.ts:38)
- `2` — minimum committed turns in char trimming (session-manager.ts:528)

### Dead code in OpenCode adapter

**File:** `src/adapters/opencode-adapter.ts:22–28`

`buildArgsWithoutPrompt()` is defined but never called because OpenCode's
`promptDelivery` is `'arg'`, not `'stdin'`.

**Fix:** Remove the dead method or change `promptDelivery` if stdin is intended.
