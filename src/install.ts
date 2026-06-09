/**
 * `wakatime-copilot-cli install` command.
 *
 * Writes the hook config to ~/.copilot/hooks/wakatime.json so it applies
 * globally to every project — no need to run `init` per repo.
 *
 * Also supports `--local` to write to .github/hooks/wakatime.json
 * for per-project (committed) configuration.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getCopilotHooksDir } from "./paths.js";

const HOOK_CONFIG = {
  version: 1,
  hooks: {
    sessionStart: [
      {
        type: "command",
        bash: "wakatime-copilot-cli hook sessionStart",
        timeoutSec: 15,
      },
    ],
    postToolUse: [
      {
        type: "command",
        bash: "wakatime-copilot-cli hook postToolUse",
        timeoutSec: 15,
      },
    ],
    sessionEnd: [
      {
        type: "command",
        bash: "wakatime-copilot-cli hook sessionEnd",
        timeoutSec: 15,
      },
    ],
  },
};

export interface InstallOptions {
  force: boolean;
  local: boolean; // true = .github/hooks (per-repo), false = ~/.copilot/hooks (global)
}

export function runInstall(opts: InstallOptions): void {
  let hooksDir: string;
  let scope: string;

  if (opts.local) {
    hooksDir = path.join(process.cwd(), ".github", "hooks");
    scope = "project (.github/hooks)";
  } else {
    hooksDir = getCopilotHooksDir();
    scope = "user (~/.copilot/hooks)";
  }

  const configPath = path.join(hooksDir, "wakatime.json");

  if (fs.existsSync(configPath) && !opts.force) {
    console.error(`Already installed at: ${configPath}`);
    console.error("Use --force to overwrite.");
    process.exit(1);
  }

  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(HOOK_CONFIG, null, 2) + "\n");

  console.log(`✓ Installed WakaTime hooks (${scope})`);
  console.log(`  Config: ${configPath}`);
  console.log();
  if (opts.local) {
    console.log("Tip: commit .github/hooks/wakatime.json to share with your team.");
  } else {
    console.log("Hooks will fire automatically for every Copilot CLI session.");
  }
  console.log();
  console.log("Make sure your WakaTime API key is set:");
  console.log("  ~/.wakatime.cfg  →  api_key = waka_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
  console.log();
  console.log("To verify it's working, run with --debug:");
  console.log("  wakatime-copilot-cli hook sessionStart --debug");
}
