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
type PersistentContextOptions = NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]>;

/**
 * Non-Chrome Chromium forks (Brave, Vivaldi, ...) aren't Playwright "channels" —
 * they're only reachable via an explicit executablePath. If one is set, it wins
 * over OMEGAFETCH_CHANNEL.
 */
function browserLaunchTarget(): Pick<PersistentContextOptions, "channel" | "executablePath"> {
  const executablePath = process.env.OMEGAFETCH_EXECUTABLE_PATH;
  if (executablePath) return { executablePath };
  const channel = process.env.OMEGAFETCH_CHANNEL;
  if (channel) return { channel };
  return {};
}

export async function getBrowserContext(): Promise<BrowserContext> {
  if (!contextPromise) {
    contextPromise = chromium
      .launchPersistentContext(profileDir(), {
        headless: isHeadless(),
        ...browserLaunchTarget(),
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
