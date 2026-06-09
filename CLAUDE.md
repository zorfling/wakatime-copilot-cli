# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A CLI/npm package (`wakatime-copilot-cli`) that integrates [WakaTime](https://wakatime.com) time-tracking into [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli). It installs Copilot CLI hooks that fire on session lifecycle events and send heartbeats to WakaTime under the **"ai coding"** category, attributed to real files (not virtual placeholder files).

## Commands

```sh
npm run build      # tsc — compiles src/ → dist/
npm run dev        # tsx src/cli.ts — run the CLI from source without building
npm test           # node --test --import tsx test/**/*.test.ts

# Run the CLI locally from source (any subcommand):
npm run dev -- setup
npm run dev -- status
npm run dev -- hook sessionStart --debug
```

`dist/cli.js` is the published `bin` entry. The package ships compiled JS; `dist/` is gitignored, so `npm run build` must run before publish (`prepublishOnly` enforces this).

Note: `npm test` references `test/**/*.test.ts` but no `test/` directory exists yet — there are currently no tests. Manual verification is done by piping a JSON payload into a hook with `--debug`:

```sh
echo '{"cwd":"/your/project","sessionId":"test"}' | npm run dev -- hook sessionStart --debug
```

## Architecture

ESM TypeScript (`"type": "module"`, `Node16` module resolution). **All intra-package imports use `.js` extensions** even though sources are `.ts` — required by Node16 resolution. Keep this when adding imports.

[src/cli.ts](src/cli.ts) is the entry point — a `switch` over `argv[2]` dispatching to four command modules. The `hook` case calls `process.exit(0)` explicitly because Node's HTTP agent can keep the event loop alive after a network request; Copilot CLI reads the exit code.

### The hook flow (the core of the package)

[src/hook.ts](src/hook.ts) `runHook()` is invoked by Copilot CLI on `sessionStart`, `postToolUse`, and `sessionEnd`. It:
1. Reads a JSON payload from **stdin** (`{ cwd, sessionId, toolName?, toolOutput?, toolInput? }`) via [src/util.ts](src/util.ts) `readStdin()`.
2. Skips self-recursion (tool names starting with `wakatime`).
3. Resolves the git repo root → project name ([src/util.ts](src/util.ts) `getRepoRoot`).
4. **Rate-limits to 1 heartbeat / 60s per project** via a timestamp file in the state dir (`shouldRateLimit`). This is the main guard against heartbeat spam.
5. Ensures `wakatime-cli` is installed ([src/wakatime-cli.ts](src/wakatime-cli.ts)).
6. Picks an **entity** (the tracked file): first a path extracted from `toolInput` keys, else the most-recently-modified source file under cwd within the last 10 min (`findBestEntity`), else falls back to `--entity-type app` "GitHub Copilot CLI".
7. Computes net lines changed since the last heartbeat from `git diff --numstat` (`consumeLineChangeDelta`, sent as `--ai-line-changes`).
8. Spawns `wakatime-cli` ([src/heartbeat.ts](src/heartbeat.ts) `sendHeartbeat`).

### Modules

| File | Responsibility |
|---|---|
| [src/cli.ts](src/cli.ts) | Arg parsing + command dispatch |
| [src/hook.ts](src/hook.ts) | Hook event handler (entity resolution, rate-limit, write detection) |
| [src/heartbeat.ts](src/heartbeat.ts) | Builds and spawns the `wakatime-cli` heartbeat command |
| [src/wakatime-cli.ts](src/wakatime-cli.ts) | Auto-downloads/updates the `wakatime-cli` binary from GitHub releases (caches version 1h, prefers a system install on PATH) |
| [src/install.ts](src/install.ts) | Writes the hook config JSON (global `~/.copilot/hooks` or `--local` `.github/hooks`) |
| [src/setup.ts](src/setup.ts) | Interactive wizard: download CLI → prompt/save API key → install global hooks |
| [src/status.ts](src/status.ts) | Diagnostics: CLI version, API key (masked), hook locations |
| [src/paths.ts](src/paths.ts) | Single source of truth for all filesystem paths |
| [src/util.ts](src/util.ts) | git helpers, stdin reader, rate-limit + diff-delta state files, entity finder |
| [src/logger.ts](src/logger.ts) | Appends to `~/.wakatime/wakatime-copilot-cli.log`; stderr only when `--debug` |

### Conventions

- **All paths go through [src/paths.ts](src/paths.ts).** It honors env overrides (`WAKATIME_HOME`, `COPILOT_HOME`, `XDG_STATE_HOME`, Windows `LOCALAPPDATA`/`USERPROFILE`) and handles cross-platform differences. Don't hardcode `~/.wakatime` etc. elsewhere.
- **Hooks must never crash.** Logging, state writes, and downloads are all wrapped in try/catch that fail silently or fall back. A failing hook would disrupt the user's Copilot CLI session. Preserve this defensiveness.
- External processes (`git`, `tar`, `wakatime-cli`) are run via `spawnSync` with short timeouts and `status`-checked, never assumed present.
- The plugin version string (`wakatime-copilot-cli/1.0.0`) is hardcoded in [src/heartbeat.ts](src/heartbeat.ts) (`PLUGIN_VERSION`) — update it alongside `package.json` `version`.
- When Copilot CLI adds new file-writing tools, extend the `WRITE_TOOLS` set in [src/hook.ts](src/hook.ts) (controls the `--write` flag).
