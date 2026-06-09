/**
 * Auto-downloads and manages the wakatime-cli binary.
 * Mirrors how official WakaTime plugins handle this — users shouldn't need
 * to install wakatime-cli separately.
 */

import * as fs from "node:fs";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { getWakatimeDir, getCliPath } from "./paths.js";
import { log } from "./logger.js";

const GITHUB_API = "https://api.github.com/repos/wakatime/wakatime-cli/releases/latest";
const GITHUB_DL = "https://github.com/wakatime/wakatime-cli/releases/download";
const VERSION_CACHE = path.join(getWakatimeDir(), "wakatime-cli-version.json");

interface VersionCache {
  version: string;
  checkedAt: number;
}

function getPlatform(): string {
  switch (process.platform) {
    case "darwin": return "darwin";
    case "win32": return "windows";
    default: return "linux";
  }
}

function getArch(): string {
  switch (process.arch) {
    case "x64": return "amd64";
    case "arm64": return "arm64";
    case "arm": return "arm";
    case "ia32": return "386";
    default: return "amd64";
  }
}

function getZipName(version: string): string {
  const platform = getPlatform();
  const arch = getArch();
  const ext = platform === "windows" ? ".zip" : ".tar.gz";
  return `wakatime-cli-${platform}-${arch}${ext}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { "User-Agent": "wakatime-copilot-cli" },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        fetchJson<T>(res.headers.location!).then(resolve).catch(reject);
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()) as T);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(15_000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (u: string) => {
      https.get(u, { headers: { "User-Agent": "wakatime-copilot-cli" } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          follow(res.headers.location!);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          return;
        }
        const out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on("finish", () => out.close(() => resolve()));
        out.on("error", reject);
      }).on("error", reject);
    };
    follow(url);
  });
}

async function extractTarGz(archive: string, destDir: string, binaryName: string): Promise<string> {
  // Use system tar if available (faster), otherwise stream manually
  const tarResult = spawnSync("tar", ["-xzf", archive, "-C", destDir], { encoding: "utf8" });
  if (tarResult.status === 0) {
    const extracted = path.join(destDir, binaryName);
    if (fs.existsSync(extracted)) return extracted;
  }

  // Fallback: stream decompress
  await new Promise<void>((resolve, reject) => {
    const src = fs.createReadStream(archive);
    const gunzip = zlib.createGunzip();
    // We just need the binary; write everything to a temp file and hope tar handles it
    const out = fs.createWriteStream(path.join(destDir, "wakatime-cli.tmp"));
    src.pipe(gunzip).pipe(out);
    out.on("finish", () => out.close(() => resolve()));
    src.on("error", reject);
    gunzip.on("error", reject);
  });
  throw new Error("Could not extract tar.gz — please install tar or download wakatime-cli manually");
}

async function getLatestVersion(): Promise<string> {
  // Check cache (1 hour)
  try {
    const c = JSON.parse(fs.readFileSync(VERSION_CACHE, "utf-8")) as VersionCache;
    if (Date.now() - c.checkedAt < 3_600_000) {
      return c.version;
    }
  } catch { /* no cache */ }

  const data = await fetchJson<{ tag_name: string }>(GITHUB_API);
  const version = data.tag_name;

  fs.mkdirSync(path.dirname(VERSION_CACHE), { recursive: true });
  fs.writeFileSync(VERSION_CACHE, JSON.stringify({ version, checkedAt: Date.now() }));
  return version;
}

function getCurrentVersion(cliPath: string): string | null {
  try {
    const r = spawnSync(cliPath, ["--version"], { encoding: "utf8", timeout: 5_000 });
    if (r.status === 0) return r.stdout.trim();
  } catch { /* */ }
  return null;
}

/**
 * Ensures wakatime-cli is present and reasonably up to date.
 * Returns the path to the binary, or null if installation failed.
 */
export async function ensureCliInstalled(): Promise<string | null> {
  const cliPath = getCliPath();
  const wakatimeDir = getWakatimeDir();

  fs.mkdirSync(wakatimeDir, { recursive: true });

  // Check for existing system install
  const systemResult = spawnSync("wakatime-cli", ["--version"], { encoding: "utf8", timeout: 5_000 });
  if (systemResult.status === 0) {
    log.debug(`Using system wakatime-cli: ${systemResult.stdout.trim()}`);
    return "wakatime-cli"; // already on PATH
  }

  let latestVersion: string;
  try {
    latestVersion = await getLatestVersion();
  } catch (e) {
    log.warn(`Could not fetch latest wakatime-cli version: ${e}`);
    // Fall back to whatever we have
    if (fs.existsSync(cliPath)) {
      log.debug("Using cached wakatime-cli (version check failed)");
      return cliPath;
    }
    return null;
  }

  // Check if our managed copy is already up to date
  if (fs.existsSync(cliPath)) {
    const current = getCurrentVersion(cliPath);
    if (current && current.includes(latestVersion.replace(/^v/, ""))) {
      log.debug(`wakatime-cli ${current} is up to date`);
      return cliPath;
    }
  }

  // Download and install
  log.info(`Downloading wakatime-cli ${latestVersion}...`);
  const zipName = getZipName(latestVersion);
  const url = `${GITHUB_DL}/${latestVersion}/${zipName}`;
  const tmpArchive = path.join(wakatimeDir, zipName);

  try {
    await downloadFile(url, tmpArchive);

    const platform = getPlatform();
    const binaryName = platform === "windows" ? "wakatime-cli.exe" : "wakatime-cli";

    if (zipName.endsWith(".tar.gz")) {
      await extractTarGz(tmpArchive, wakatimeDir, binaryName);
    } else {
      // .zip (Windows)
      const { execSync } = await import("node:child_process");
      execSync(`powershell -Command "Expand-Archive -Path '${tmpArchive}' -DestinationPath '${wakatimeDir}' -Force"`, { timeout: 30_000 });
    }

    // Clean up archive
    try { fs.unlinkSync(tmpArchive); } catch { /* */ }

    // Make executable on Unix
    if (platform !== "windows" && fs.existsSync(cliPath)) {
      fs.chmodSync(cliPath, 0o755);
    }

    const installed = getCurrentVersion(cliPath);
    log.info(`wakatime-cli ${installed ?? latestVersion} installed at ${cliPath}`);
    return cliPath;
  } catch (e) {
    log.error(`Failed to install wakatime-cli: ${e}`);
    try { fs.unlinkSync(tmpArchive); } catch { /* */ }
    return null;
  }
}
