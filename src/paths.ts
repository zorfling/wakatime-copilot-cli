import * as os from "node:os";
import * as path from "node:path";

/**
 * Base directory for all WakaTime resources (~/.wakatime or $WAKATIME_HOME).
 */
export function getWakatimeDir(): string {
  return process.env.WAKATIME_HOME ?? path.join(os.homedir(), ".wakatime");
}

/**
 * Path to the wakatime-cli binary we manage.
 * Named with OS+arch so multiple architectures can coexist.
 */
export function getCliPath(): string {
  const ext = process.platform === "win32" ? ".exe" : "";
  return path.join(getWakatimeDir(), `wakatime-cli${ext}`);
}

/**
 * Path to ~/.wakatime.cfg (or $WAKATIME_HOME/.wakatime.cfg).
 */
export function getConfigPath(): string {
  return path.join(getWakatimeDir(), "..", ".wakatime.cfg");
}

/**
 * Plugin log file.
 */
export function getLogPath(): string {
  return path.join(getWakatimeDir(), "wakatime-copilot-cli.log");
}

/**
 * State dir for per-project rate-limit timestamps.
 * Follows XDG Base Directory spec on Linux/macOS.
 */
export function getStateDir(): string {
  if (process.env.XDG_STATE_HOME) {
    return path.join(process.env.XDG_STATE_HOME, "copilot-wakatime");
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA ?? os.homedir(),
      "copilot-wakatime",
    );
  }
  return path.join(os.homedir(), ".local", "state", "copilot-wakatime");
}

/**
 * User-level Copilot CLI hooks directory (~/.copilot/hooks).
 * Hooks placed here apply globally to every project.
 */
export function getCopilotHooksDir(): string {
  if (process.env.COPILOT_HOME) {
    return path.join(process.env.COPILOT_HOME, "hooks");
  }
  if (process.platform === "win32") {
    return path.join(process.env.USERPROFILE ?? os.homedir(), ".copilot", "hooks");
  }
  return path.join(os.homedir(), ".copilot", "hooks");
}
