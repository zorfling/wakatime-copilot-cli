import * as fs from "node:fs";
import * as path from "node:path";
import { getLogPath } from "./paths.js";

let debugEnabled = false;

export function setDebug(enabled: boolean): void {
  debugEnabled = enabled;
}

function timestamp(): string {
  return new Date().toISOString();
}

function write(level: string, msg: string): void {
  const line = `${timestamp()} [${level}] ${msg}\n`;
  try {
    fs.mkdirSync(path.dirname(getLogPath()), { recursive: true });
    fs.appendFileSync(getLogPath(), line);
  } catch {
    // Never crash the hook just because logging failed
  }
}

export const log = {
  debug(msg: string): void {
    if (debugEnabled) {
      write("DEBUG", msg);
      process.stderr.write(`[wakatime-copilot-cli] DEBUG: ${msg}\n`);
    }
  },
  info(msg: string): void {
    write("INFO", msg);
  },
  warn(msg: string): void {
    write("WARN", msg);
    process.stderr.write(`[wakatime-copilot-cli] WARN: ${msg}\n`);
  },
  error(msg: string): void {
    write("ERROR", msg);
    process.stderr.write(`[wakatime-copilot-cli] ERROR: ${msg}\n`);
  },
};
