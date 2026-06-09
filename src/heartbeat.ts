/**
 * Sends a single heartbeat to WakaTime via wakatime-cli.
 *
 * Key differences from the naive implementation:
 * - Uses --category "ai coding" so time shows under AI Coding on the dashboard
 * - No virtual files: entity is either the actual file being worked on
 *   or falls back to --entity-type app with "GitHub Copilot CLI"
 * - Proper --plugin string so WakaTime can identify this plugin
 */

import { spawnSync } from "node:child_process";
import { log } from "./logger.js";

const PLUGIN_VERSION = "1.0.0";
const PLUGIN_NAME = `wakatime-copilot-cli/${PLUGIN_VERSION}`;

export interface HeartbeatOptions {
  /** Absolute path to the wakatime-cli binary (or "wakatime-cli" if on PATH). */
  cliBin: string;
  /** The file being worked on (absolute path), or null to use app entity. */
  entity: string | null;
  /** Project name (typically the git repo folder name). */
  project: string;
  /** Working directory — used as project folder hint. */
  projectFolder: string;
  /** Whether this heartbeat was triggered by a write event. */
  isWrite?: boolean;
  /**
   * Net lines changed since the last heartbeat (additions - deletions).
   * Sent as --ai-line-changes so WakaTime can display AI coding line metrics.
   * Null means omit the flag entirely (no changes detected or not in a git repo).
   */
  aiLineChanges?: number | null;
}

export function sendHeartbeat(opts: HeartbeatOptions): void {
  const { cliBin, entity, project, projectFolder, isWrite, aiLineChanges } = opts;

  const args: string[] = [
    "--category", "ai coding",
    "--plugin", PLUGIN_NAME,
    "--project", project,
    "--project-folder", projectFolder,
  ];

  if (entity) {
    args.push("--entity", entity);
    args.push("--entity-type", "file");
  } else {
    // No file detected — log against the app itself
    args.push("--entity", "GitHub Copilot CLI");
    args.push("--entity-type", "app");
  }

  if (isWrite) {
    args.push("--write");
  }

  // Pass net line changes so WakaTime can surface AI coding line metrics
  if (aiLineChanges != null && aiLineChanges !== 0) {
    args.push("--ai-line-changes", String(aiLineChanges));
  }

  log.debug(`Running: ${cliBin} ${args.join(" ")}`);

  const result = spawnSync(cliBin, args, {
    encoding: "utf8",
    timeout: 10_000,
  });

  if (result.status !== 0) {
    log.warn(`wakatime-cli exited ${result.status}: ${result.stderr?.trim()}`);
  } else {
    log.debug(`Heartbeat sent for ${entity ?? "GitHub Copilot CLI"}`);
  }
}
