#!/usr/bin/env node
/**
 * wakatime-copilot-cli CLI entry point.
 *
 * Commands:
 *   setup                      Interactive first-time setup (recommended)
 *   install [--local] [--force] Write hook config (global by default)
 *   hook <event> [--debug]     Called by Copilot CLI hooks — sends heartbeat
 *   status                     Show config and wakatime-cli version
 */

import { runHook } from "./hook.js";
import { runInstall } from "./install.js";
import { runSetup } from "./setup.js";
import { runStatus } from "./status.js";

const args = process.argv.slice(2);
const cmd = args[0];

async function main(): Promise<void> {
  switch (cmd) {
    case "setup": {
      await runSetup();
      break;
    }

    case "install": {
      runInstall({
        force: args.includes("--force"),
        local: args.includes("--local"),
      });
      break;
    }

    case "hook": {
      const event = args[1] ?? "unknown";
      const debug = args.includes("--debug");
      await runHook({ event, debug });
      // Hooks are short-lived processes. Node's HTTP agent can keep the event
      // loop alive after a failed network request (e.g. version check), so
      // we exit explicitly. Copilot CLI reads our exit code — 0 = success.
      process.exit(0);
    }

    case "status": {
      await runStatus();
      break;
    }

    default: {
      console.error(`wakatime-copilot-cli — WakaTime integration for GitHub Copilot CLI

Usage:
  wakatime-copilot-cli setup               First-time setup wizard (recommended)
  wakatime-copilot-cli install             Install global hooks (~/.copilot/hooks)
  wakatime-copilot-cli install --local     Install per-project hooks (.github/hooks)
  wakatime-copilot-cli install --force     Overwrite existing hook config
  wakatime-copilot-cli hook <event>        Process hook event (called by Copilot CLI)
  wakatime-copilot-cli hook <event> --debug  Verbose output
  wakatime-copilot-cli status              Show config and wakatime-cli status

Events: sessionStart | postToolUse | sessionEnd
`);
      process.exit(cmd ? 1 : 0);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`wakatime-copilot-cli fatal: ${err}\n`);
  process.exit(1);
});
