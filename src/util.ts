import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { getStateDir } from "./paths.js";

/**
 * Detect the Git repository root for a given working directory.
 * Returns null if not in a Git repo.
 */
export function getRepoRoot(cwd: string): string | null {
  try {
    const r = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      timeout: 3_000,
    });
    if (r.status !== 0) return null;
    const out = r.stdout.trim();
    return out.length ? out : null;
  } catch {
    return null;
  }
}

/**
 * Rate-limit by project key. Returns true if we should skip (too soon).
 * Uses a flat file per project-key in the state dir.
 */
export function shouldRateLimit(key: string, windowSeconds: number): boolean {
  const dir = getStateDir();
  fs.mkdirSync(dir, { recursive: true });

  // Sanitize key into a safe filename
  const safeKey = key.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 128);
  const stamp = path.join(dir, safeKey);
  const now = Math.floor(Date.now() / 1000);

  let last = 0;
  try {
    last = parseInt(fs.readFileSync(stamp, "utf-8"), 10) || 0;
  } catch { /* first run */ }

  if (now - last < windowSeconds) return true;

  try {
    fs.writeFileSync(stamp, String(now));
  } catch { /* best effort */ }

  return false;
}

/**
 * Read all data from stdin as a string.
 *
 * Resolves immediately with "" when:
 *   - stdin is a TTY (interactive terminal, no payload coming)
 *   - no data arrives within 2 seconds (safety net for unexpected cases)
 *
 * Copilot CLI always pipes the JSON payload and closes stdin, so neither
 * timeout nor TTY check affects normal hook operation.
 */
export function readStdin(): Promise<string> {
  // If running interactively (e.g. manual --debug test), don't hang
  if (process.stdin.isTTY) {
    return Promise.resolve("");
  }

  return new Promise((resolve, reject) => {
    let data = "";
    let settled = false;

    const done = (result: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    // Safety timeout: if stdin doesn't close within 2s, proceed with what we have
    const timer = setTimeout(() => done(data), 2_000);

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => { data += chunk; });
    process.stdin.on("end", () => done(data));
    process.stdin.on("error", (err) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(err); }
    });
  });
}

export interface DiffStats {
  additions: number;
  deletions: number;
}

/**
 * Get the total lines added/deleted in the working tree (staged + unstaged)
 * relative to HEAD, for the given repo root.
 *
 * This is used to compute the delta between heartbeats and pass as
 * --ai-line-changes to wakatime-cli.
 */
export function getRepoDiffStats(repoRoot: string): DiffStats {
  const stats: DiffStats = { additions: 0, deletions: 0 };

  // Parse `git diff --numstat` output: "<additions>\t<deletions>\t<file>"
  function parseNumstat(output: string): void {
    for (const line of output.split("\n")) {
      const parts = line.trim().split("\t");
      if (parts.length >= 2) {
        const add = parseInt(parts[0], 10);
        const del = parseInt(parts[1], 10);
        if (!isNaN(add)) stats.additions += add;
        if (!isNaN(del)) stats.deletions += del;
      }
    }
  }

  // Unstaged changes (working tree vs index)
  const unstaged = spawnSync("git", ["-C", repoRoot, "diff", "--numstat"], {
    encoding: "utf8", timeout: 3_000,
  });
  if (unstaged.status === 0) parseNumstat(unstaged.stdout);

  // Staged changes (index vs HEAD)
  const staged = spawnSync("git", ["-C", repoRoot, "diff", "--numstat", "--cached"], {
    encoding: "utf8", timeout: 3_000,
  });
  if (staged.status === 0) parseNumstat(staged.stdout);

  return stats;
}

/**
 * State file for persisting the last-seen diff stats per repo root.
 * Allows us to compute the delta (lines changed since last heartbeat).
 */
function getDiffStateFile(repoRoot: string): string {
  const dir = getStateDir();
  fs.mkdirSync(dir, { recursive: true });
  const safeKey = repoRoot.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 128) + ".diff";
  return path.join(dir, safeKey);
}

/**
 * Returns the net lines changed (additions - deletions) since the last
 * heartbeat for this repo, then updates the stored baseline.
 *
 * Returns null if we're not in a git repo or git is unavailable.
 */
export function consumeLineChangeDelta(repoRoot: string): number | null {
  const current = getRepoDiffStats(repoRoot);
  const stateFile = getDiffStateFile(repoRoot);

  let previous: DiffStats = { additions: 0, deletions: 0 };
  try {
    previous = JSON.parse(fs.readFileSync(stateFile, "utf-8")) as DiffStats;
  } catch { /* first run or no file */ }

  // Delta since last heartbeat
  const deltaAdd = Math.max(0, current.additions - previous.additions);
  const deltaDel = Math.max(0, current.deletions - previous.deletions);

  // Persist current as new baseline
  try {
    fs.writeFileSync(stateFile, JSON.stringify(current));
  } catch { /* best effort */ }

  const net = deltaAdd - deltaDel;
  // Only return a value if something actually changed
  return net !== 0 ? net : null;
}

/**
 * Attempt to find a recently-modified source file under cwd to use as the
 * tracked entity. Falls back to cwd itself if nothing suitable found.
 *
 * This avoids the "virtual file" hack: we track a real file that the
 * AI is actually working with in this session.
 */
export function findBestEntity(cwd: string): string {
  const SOURCE_EXTS = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
    ".c", ".cpp", ".h", ".hpp", ".cs", ".php",
    ".vue", ".svelte", ".html", ".css", ".scss",
    ".json", ".yaml", ".yml", ".toml", ".md",
    ".sh", ".bash", ".zsh", ".fish",
  ]);

  const IGNORE = new Set(["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv", "venv"]);

  let best: { file: string; mtime: number } | null = null as { file: string; mtime: number } | null;
  const cutoff = Date.now() - 10 * 60 * 1000; // last 10 minutes

  function scan(dir: string, depth: number): void {
    if (depth > 3) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      if (IGNORE.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!SOURCE_EXTS.has(ext)) continue;
        try {
          const stat = fs.statSync(full);
          const mtime = stat.mtimeMs;
          if (mtime >= cutoff && (best === null || mtime > best.mtime)) {
            best = { file: full, mtime };
          }
        } catch { /* skip */ }
      }
    }
  }

  scan(cwd, 0);
  return best?.file ?? cwd;
}
