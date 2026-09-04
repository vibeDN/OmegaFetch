import { chromium, type BrowserContext } from "playwright";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

let contextPromise: Promise<BrowserContext> | null = null;

function profileDir(): string {
  const dir =
    process.env.OMEGAFETCH_PROFILE_DIR ??
    path.join(os.homedir(), ".omegafetch", "profile");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function isHeadless(): boolean {
  const v = process.env.OMEGAFETCH_HEADLESS;
  if (v === undefined) return true;
  return v !== "0" && v.toLowerCase() !== "false";
}

/**
 * Lazily launches (and reuses) a persistent Chromium context on this device.
 * Persistent so cookies/logins survive across calls — that's what lets the
 * bridge get past auth walls a stateless server-side fetch never could.
 */
export async function getBrowserContext(): Promise<BrowserContext> {
  if (!contextPromise) {
    contextPromise = chromium
      .launchPersistentContext(profileDir(), {
        headless: isHeadless(),
        channel: process.env.OMEGAFETCH_CHANNEL,
        viewport: { width: 1366, height: 900 },
        userAgent: process.env.OMEGAFETCH_USER_AGENT,
        locale: process.env.OMEGAFETCH_LOCALE ?? "en-US",
      })
      .catch((err) => {
        contextPromise = null;
        throw err;
      });
  }
  return contextPromise;
}

export async function closeBrowserContext(): Promise<boolean> {
  if (!contextPromise) return false;
  const ctx = await contextPromise;
  contextPromise = null;
  await ctx.close();
  return true;
}
