# wakatime-copilot-cli

WakaTime integration for [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli) — automatically tracks your AI coding time with proper attribution.

## Why this over the existing one?

| | This plugin | [geeknees/copilot-cli-wakatime](https://github.com/geeknees/copilot-cli-wakatime) |
|---|---|---|
| AI coding category | ✅ `--category "ai coding"` | ❌ defaults to "coding" |
| Virtual files | ✅ None — tracks real files | ❌ Creates `.copilot-cli.ts` in your repo |
| wakatime-cli install | ✅ Auto-downloads | ❌ Must install manually |
| Global install | ✅ `~/.copilot/hooks` (all projects) | ❌ Per-repo only |
| Entity tracking | ✅ Finds recently-modified files | ❌ Always the same fake file |

## Quick start

```sh
npm install -g wakatime-copilot-cli
wakatime-copilot-cli setup
```

`setup` will:
1. Download `wakatime-cli` automatically if you don't have it
2. Prompt for your WakaTime API key (from https://wakatime.com/api-key)
3. Install hooks globally to `~/.copilot/hooks/`

That's it. All future Copilot CLI sessions across every project will be tracked.

## Manual install

```sh
npm install -g wakatime-copilot-cli

# Global hooks (recommended — works in every project)
wakatime-copilot-cli install

# Per-project hooks (committed to repo)
wakatime-copilot-cli install --local
```

Make sure your API key is in `~/.wakatime.cfg`:

```ini
[settings]
api_key = waka_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Commands

| Command | Description |
|---|---|
| `wakatime-copilot-cli setup` | Interactive wizard — recommended first step |
| `wakatime-copilot-cli install` | Write hook config to `~/.copilot/hooks/` |
| `wakatime-copilot-cli install --local` | Write hook config to `.github/hooks/` |
| `wakatime-copilot-cli install --force` | Overwrite existing hook config |
| `wakatime-copilot-cli status` | Show config, wakatime-cli version, hook locations |
| `wakatime-copilot-cli hook <event>` | Called by Copilot CLI (not for manual use) |
| `wakatime-copilot-cli hook <event> --debug` | Verbose hook output + logging |

## How it works

Copilot CLI supports [hook files](https://docs.github.com/en/copilot/reference/hooks-configuration) that run shell commands at key session lifecycle points. This plugin installs a hook that fires on:

- **`sessionStart`** — when a Copilot CLI session begins
- **`postToolUse`** — after each tool execution
- **`sessionEnd`** — when the session ends

Each event sends a heartbeat to WakaTime via `wakatime-cli` with:

- `--category "ai coding"` — appears as **AI Coding** on your WakaTime dashboard
- `--entity <file>` — the most-recently-modified source file in the working directory, so your project and language are correctly attributed
- `--entity-type app` with `--entity "GitHub Copilot CLI"` if no file was found
- `--plugin wakatime-copilot-cli/1.0.0` — proper plugin identifier
- Rate-limited to 1 heartbeat per 60 seconds per project

## Hooks configuration

The installed hook file looks like:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      { "type": "command", "bash": "wakatime-copilot-cli hook sessionStart", "timeoutSec": 15 }
    ],
    "postToolUse": [
      { "type": "command", "bash": "wakatime-copilot-cli hook postToolUse", "timeoutSec": 15 }
    ],
    "sessionEnd": [
      { "type": "command", "bash": "wakatime-copilot-cli hook sessionEnd", "timeoutSec": 15 }
    ]
  }
}
```

Global location: `~/.copilot/hooks/wakatime.json`  
Per-project location: `.github/hooks/wakatime.json`

## Files

| Path | Purpose |
|---|---|
| `~/.wakatime/wakatime-cli` | Auto-managed wakatime-cli binary |
| `~/.wakatime/.wakatime.cfg` | WakaTime config (API key) |
| `~/.wakatime/wakatime-copilot-cli.log` | Debug log |
| `~/.local/state/copilot-wakatime/<project>` | Per-project rate-limit timestamps |
| `~/.copilot/hooks/wakatime.json` | Global hook config |

## Debugging

Run any hook manually with `--debug` to see what's happening:

```sh
echo '{"cwd":"/your/project","sessionId":"test"}' | wakatime-copilot-cli hook sessionStart --debug
```

Or check the log:

```sh
tail -f ~/.wakatime/wakatime-copilot-cli.log
```

## Troubleshooting

**No time showing on WakaTime dashboard**
1. Run `wakatime-copilot-cli status` — check all items show ✓
2. Run a hook with `--debug` and look for errors
3. Check `~/.wakatime/wakatime.log` for wakatime-cli errors

**wakatime-cli fails to download**
```sh
brew install wakatime-cli   # macOS
# or download from https://github.com/wakatime/wakatime-cli/releases
```

**Time tracked under "coding" not "AI Coding"**
Old heartbeats may have been sent without the category flag. New heartbeats from this plugin will correctly use the "ai coding" category.

## License

MIT
