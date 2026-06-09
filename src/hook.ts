/**
 * Core hook handler — called by Copilot CLI for sessionStart, postToolUse,
 * and sessionEnd events.
 *
 * Payload received on stdin (JSON):
 *   {
 *     cwd: string            // working directory when copilot was invoked
 *     sessionId: string      // unique session identifier
 *     toolName?: string      // (postToolUse) name of tool that just ran
 *     toolOutput?: string    // (postToolUse) tool stdout, may contain file paths
 *   }
 */

import * as path from "node:path";
import { ensureCliInstalled } from "./wakatime-cli.js";
import { sendHeartbeat } from "./heartbeat.js";
import { getRepoRoot, shouldRateLimit, readStdin, findBestEntity, consumeLineChangeDelta } from "./util.js";
import { log, setDebug } from "./logger.js";

// Copilot CLI tool names that write or modify files — we treat these as write events
const WRITE_TOOLS = new Set([
  "write_file", "create_file", "edit_file", "insert_content",
  "replace_string_in_file", "apply_patch", "run_in_terminal",
  // Add more as the Copilot CLI tool set expands
]);

// Tool names containing these strings should be skipped (avoid self-loops)
const SKIP_PREFIXES = ["wakatime"];

interface HookPayload {
  cwd?: string;
  sessionId?: string;
  toolName?: string;
  toolOutput?: string;
  // postToolUse may include info about files the tool touched
  toolInput?: Record<string, unknown>;
}

export interface HookOptions {
  event: string;
  debug: boolean;
}

export async function runHook(opts: HookOptions): Promise<void> {
  setDebug(opts.debug);

  // Read payload immediately — don't delay or Copilot CLI may hang
  const raw = await readStdin();

  let payload: HookPayload = {};
  try {
    payload = raw.trim() ? (JSON.parse(raw) as HookPayload) : {};
  } catch {
    log.debug(`Could not parse stdin payload: ${raw.slice(0, 200)}`);
  }

  log.debug(`Hook event: ${opts.event}, payload: ${JSON.stringify(payload)}`);

  // Guard against self-recursion if WakaTime itself runs as a tool
  const toolName = payload.toolName ?? null;
  if (toolName) {
    for (const prefix of SKIP_PREFIXES) {
      if (toolName.toLowerCase().startsWith(prefix)) {
        log.debug(`Skipping — toolName starts with '${prefix}'`);
        return;
      }
    }
  }

  // Resolve working directory
  const cwd =
    typeof payload.cwd === "string" && payload.cwd.trim()
      ? payload.cwd.trim()
      : process.cwd();

  // Detect git repo root and project name
  const repoRoot = getRepoRoot(cwd) ?? cwd;
  const project = path.basename(repoRoot);

  // Rate-limit to 1 heartbeat per 60s per project
  // (WakaTime itself deduplicates further on their end)
  if (shouldRateLimit(project, 60)) {
    log.debug(`Rate-limited for project '${project}', skipping`);
    return;
  }

  // Ensure wakatime-cli is installed (async, but first run only takes extra time)
  const cliBin = await ensureCliInstalled();
  if (!cliBin) {
    log.error("wakatime-cli not available — heartbeat skipped");
    return;
  }

  // Determine what to track as the entity.
  //
  // Priority order:
  // 1. File explicitly mentioned in tool input (e.g., edit_file's target)
  // 2. Most-recently-modified source file under cwd (within last 10 min)
  // 3. null → falls back to entity-type=app in heartbeat.ts
  let entity: string | null = extractFileFromTool(toolName, payload);
  if (!entity) {
    entity = findBestEntity(cwd);
    if (entity === cwd) entity = null; // couldn't find a real file
  }

  const isWrite = toolName ? WRITE_TOOLS.has(toolName) : false;

  // Compute net lines changed since the last heartbeat via git diff.
  // consumeLineChangeDelta also advances the baseline so the next call
  // only counts new changes, not the same diff twice.
  const aiLineChanges = consumeLineChangeDelta(repoRoot);

  sendHeartbeat({
    cliBin,
    entity,
    project,
    projectFolder: repoRoot,
    isWrite,
    aiLineChanges,
  });

  log.debug(`Heartbeat dispatched — project: ${project}, entity: ${entity ?? "(app)"}, event: ${opts.event}, lines: ${aiLineChanges ?? 0}`);
}

/**
 * Try to extract the file path a tool is acting on from its input payload.
 * Returns null if we can't confidently determine it.
 */
function extractFileFromTool(
  toolName: string | null,
  payload: HookPayload,
): string | null {
  if (!toolName || !payload.toolInput) return null;

  const input = payload.toolInput;

  // Common patterns across Copilot CLI tool schemas
  const pathKeys = ["path", "file", "filepath", "file_path", "filename", "target", "source"];
  for (const key of pathKeys) {
    const val = input[key];
    if (typeof val === "string" && val.trim()) {
      return path.isAbsolute(val) ? val : path.join(payload.cwd ?? process.cwd(), val);
    }
  }

  return null;
}
