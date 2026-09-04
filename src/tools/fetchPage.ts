import { getBrowserContext } from "../browser.js";
import { extractReadable, htmlToMarkdown, htmlToText } from "../extract.js";

const CHALLENGE_MARKERS = [
  "checking your browser",
  "just a moment",
  "cf-browser-verification",
  "cf_chl",
  "attention required! | cloudflare",
  "enable javascript and cookies to continue",
  "verify you are a human",
  "px-captcha",
  "distil_r_captcha",
  "__cf_chl_rt_tk",
  "access denied",
  "request unsuccessful",
];

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

const MAX_CONTENT_CHARS = 60_000;

function looksBlocked(status: number, html: string): boolean {
  if ([401, 403, 429, 503].includes(status)) return true;
  const lower = html.toLowerCase();
  if (CHALLENGE_MARKERS.some((marker) => lower.includes(marker))) return true;

  // JS-only SPA shells: lots of markup, almost no visible text.
  const visibleLen = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
  return html.length > 3000 && visibleLen < 200;
}

interface RawFetchResult {
  ok: boolean;
  status: number;
  html: string;
}

async function tryRawFetch(url: string, timeoutMs: number): Promise<RawFetchResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": DESKTOP_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    const html = await res.text();
    return { ok: res.ok, status: res.status, html };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface FetchPageInput {
  url: string;
  format: "markdown" | "text" | "html";
  forceBrowser: boolean;
  waitForSelector?: string;
  timeoutMs: number;
  fullPage: boolean;
}

export interface FetchPageResult {
  url: string;
  finalUrl: string;
  method: "raw" | "browser";
  title: string | null;
  format: string;
  content: string;
  truncated: boolean;
}

function finalizeContent(text: string): { content: string; truncated: boolean } {
  if (text.length <= MAX_CONTENT_CHARS) return { content: text, truncated: false };
  return { content: text.slice(0, MAX_CONTENT_CHARS), truncated: true };
}

function buildResult(
  requestedUrl: string,
  finalUrl: string,
  method: "raw" | "browser",
  html: string,
  format: "markdown" | "text" | "html",
  fullPage: boolean
): FetchPageResult {
  const article = fullPage ? null : extractReadable(html, finalUrl);

  let title: string | null = null;
  let raw: string;
  if (article) {
    title = article.title;
    raw = format === "text" ? article.text : format === "html" ? article.html : article.markdown;
  } else if (format === "html") {
    raw = html;
  } else if (format === "text") {
    raw = htmlToText(html);
  } else {
    raw = htmlToMarkdown(html);
  }

  const { content, truncated } = finalizeContent(raw);
  return { url: requestedUrl, finalUrl, method, title, format, content, truncated };
}

/**
 * Fetches a page's content. Tries a plain HTTP request first (cheap, fast);
 * if that comes back blocked/empty/challenged, falls back to driving a real
 * browser on this device — same IP, same fingerprint, same cookie jar a
 * human here would have.
 */
export async function fetchPage(input: FetchPageInput): Promise<FetchPageResult> {
  const { url, format, forceBrowser, waitForSelector, timeoutMs, fullPage } = input;

  if (!forceBrowser) {
    const raw = await tryRawFetch(url, Math.min(timeoutMs, 15_000));
    if (raw && raw.ok && !looksBlocked(raw.status, raw.html)) {
      return buildResult(url, url, "raw", raw.html, format, fullPage);
    }
  }

  const context = await getBrowserContext();
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: timeoutMs }).catch(() => {});
    } else {
      await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 10_000) }).catch(() => {});
    }
    const html = await page.content();
    return buildResult(url, page.url(), "browser", html, format, fullPage);
  } finally {
    await page.close();
  }
}
