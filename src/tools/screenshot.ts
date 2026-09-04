import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { getBrowserContext } from "../browser.js";

export interface ScreenshotInput {
  url: string;
  fullPage: boolean;
  timeoutMs: number;
}

export interface ScreenshotResult {
  path: string;
  base64: string;
}

function screenshotDir(): string {
  const dir = path.join(os.homedir(), ".omegafetch", "screenshots");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Renders a page in the local browser bridge and captures it as a PNG. */
export async function screenshotPage(input: ScreenshotInput): Promise<ScreenshotResult> {
  const context = await getBrowserContext();
  const page = await context.newPage();
  try {
    await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: input.timeoutMs });
    await page
      .waitForLoadState("networkidle", { timeout: Math.min(input.timeoutMs, 10_000) })
      .catch(() => {});
    const buffer = await page.screenshot({ fullPage: input.fullPage, type: "png" });
    const filePath = path.join(screenshotDir(), `${Date.now()}.png`);
    fs.writeFileSync(filePath, buffer);
    return { path: filePath, base64: buffer.toString("base64") };
  } finally {
    await page.close();
  }
}
