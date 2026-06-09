/**
 * `wakatime-copilot-cli setup` — interactive first-time setup.
 * Downloads wakatime-cli and verifies the API key exists.
 */

import * as fs from "node:fs";
import * as readline from "node:readline";
import { ensureCliInstalled } from "./wakatime-cli.js";
import { getConfigPath } from "./paths.js";
import { runInstall } from "./install.js";

export async function runSetup(): Promise<void> {
  console.log("=== wakatime-copilot-cli setup ===\n");

  // 1. Download wakatime-cli
  console.log("1/3  Downloading wakatime-cli...");
  const cliBin = await ensureCliInstalled();
  if (!cliBin) {
    console.error("✗ Could not install wakatime-cli. Please install it manually:");
    console.error("  brew install wakatime-cli   # macOS");
    console.error("  https://github.com/wakatime/wakatime-cli/releases");
    process.exit(1);
  }
  console.log(`     ✓ wakatime-cli ready (${cliBin})\n`);

  // 2. Check / prompt for API key
  console.log("2/3  Checking WakaTime API key...");
  const cfgPath = getConfigPath();
  let hasKey = false;
  try {
    const cfg = fs.readFileSync(cfgPath, "utf-8");
    hasKey = /^\s*api_key\s*=\s*waka_\S+/m.test(cfg);
  } catch { /* no config */ }

  if (hasKey) {
    console.log("     ✓ API key found in ~/.wakatime.cfg\n");
  } else {
    console.log("     No API key found.");
    const key = await prompt("     Enter your WakaTime API key (from https://wakatime.com/api-key): ");
    if (key.trim()) {
      writeApiKey(cfgPath, key.trim());
      console.log("     ✓ API key saved\n");
    } else {
      console.log("     Skipped. Add it later to ~/.wakatime.cfg:\n");
      console.log("       [settings]");
      console.log("       api_key = waka_xxxx...\n");
    }
  }

  // 3. Install global hooks
  console.log("3/3  Installing global hooks...");
  runInstall({ force: true, local: false });
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function writeApiKey(cfgPath: string, key: string): void {
  let existing = "";
  try { existing = fs.readFileSync(cfgPath, "utf-8"); } catch { /* */ }

  if (existing.includes("[settings]")) {
    // Insert after [settings]
    existing = existing.replace(/(\[settings\][^\[]*)(api_key\s*=\s*\S+)?/, (_, section) => {
      return `${section}api_key = ${key}\n`;
    });
  } else {
    existing = `[settings]\napi_key = ${key}\n${existing}`;
  }

  // Ensure directory exists
  const dir = cfgPath.split("/").slice(0, -1).join("/");
  if (dir) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* */ }
  }
  fs.writeFileSync(cfgPath, existing);
}
