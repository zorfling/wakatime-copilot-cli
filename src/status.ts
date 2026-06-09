/**
 * `wakatime-copilot-cli status` — show install state, config paths, versions.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { getConfigPath, getCopilotHooksDir, getWakatimeDir } from "./paths.js";

export async function runStatus(): Promise<void> {
  console.log("=== wakatime-copilot-cli status ===\n");

  // wakatime-cli
  const systemCli = spawnSync("wakatime-cli", ["--version"], { encoding: "utf8", timeout: 5_000 });
  const managedCli = path.join(getWakatimeDir(), process.platform === "win32" ? "wakatime-cli.exe" : "wakatime-cli");
  const managedExists = fs.existsSync(managedCli);
  const managedVersion = managedExists
    ? spawnSync(managedCli, ["--version"], { encoding: "utf8", timeout: 5_000 }).stdout?.trim()
    : null;

  if (systemCli.status === 0) {
    console.log(`wakatime-cli:   ✓ system install (${systemCli.stdout.trim()})`);
  } else if (managedVersion) {
    console.log(`wakatime-cli:   ✓ managed install (${managedVersion})`);
    console.log(`                ${managedCli}`);
  } else {
    console.log("wakatime-cli:   ✗ not found — run: wakatime-copilot-cli setup");
  }

  // API key
  const cfgPath = getConfigPath();
  console.log(`\nConfig file:    ${cfgPath}`);
  try {
    const cfg = fs.readFileSync(cfgPath, "utf-8");
    const match = cfg.match(/^\s*api_key\s*=\s*(\S+)/m);
    if (match) {
      const key = match[1];
      const masked = key.length > 8 ? key.slice(0, 8) + "..." + key.slice(-4) : "***";
      console.log(`API key:        ✓ ${masked}`);
    } else {
      console.log("API key:        ✗ not set");
    }
  } catch {
    console.log("API key:        ✗ config file not found");
  }

  // Global hooks
  const globalHooks = path.join(getCopilotHooksDir(), "wakatime.json");
  const localHooks = path.join(process.cwd(), ".github", "hooks", "wakatime.json");
  console.log(`\nGlobal hooks:   ${fs.existsSync(globalHooks) ? "✓ " + globalHooks : "✗ not installed"}`);
  console.log(`Local hooks:    ${fs.existsSync(localHooks) ? "✓ " + localHooks : "(none in current directory)"}`);

  console.log(`\nLog file:       ${path.join(getWakatimeDir(), "wakatime-copilot-cli.log")}`);
  console.log();
}
