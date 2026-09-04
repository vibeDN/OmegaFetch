import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchPage } from "./tools/fetchPage.js";
import { screenshotPage } from "./tools/screenshot.js";
import { closeBrowserContext } from "./browser.js";

/** Builds a fresh McpServer with OmegaFetch's tools registered. */
export function buildServer(): McpServer {
  const server = new McpServer({
    name: "omegafetch",
    version: "0.1.0",
  });

  server.tool(
    "fetch_page",
    "Fetch a web page's readable content even when it blocks plain HTTP requests " +
      "(JS-only SPA, Cloudflare/anti-bot walls, login-gated content). Tries a fast raw " +
      "HTTP fetch first, and automatically falls back to driving a real browser on this " +
      "device (with a persistent cookie/session profile) when the raw fetch looks blocked " +
      "or empty. Returns clean markdown/text/html, not raw DOM soup.",
    {
      url: z.string().url().describe("The page URL to fetch."),
      format: z
        .enum(["markdown", "text", "html"])
        .default("markdown")
        .describe("Output format for the page content."),
      forceBrowser: z
        .boolean()
        .default(false)
        .describe(
          "Skip the raw HTTP attempt and go straight to the local browser bridge. Use for sites known to require JS or an existing login session."
        ),
      waitForSelector: z
        .string()
        .optional()
        .describe("CSS selector to wait for before extracting content (browser mode only)."),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .max(120_000)
        .default(30_000)
        .describe("Max time to wait for the page to load, in milliseconds."),
      fullPage: z
        .boolean()
        .default(false)
        .describe(
          "Return the full page content instead of the extracted main-article text. Use for non-article pages like dashboards or search results."
        ),
    },
    async (input) => {
      try {
        const result = await fetchPage(input);
        const header =
          `# ${result.title ?? result.finalUrl}\n` +
          `source: ${result.finalUrl}\n` +
          `fetched via: ${result.method}${result.truncated ? " (truncated)" : ""}\n\n`;
        return { content: [{ type: "text" as const, text: header + result.content }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Failed to fetch ${input.url}: ${(err as Error).message}` }],
        };
      }
    }
  );

  server.tool(
    "screenshot_page",
    "Take a screenshot of a page using the local browser bridge. Useful for seeing what's " +
      "actually blocking a fetch (captcha, cookie wall, layout) or for visually checking a page.",
    {
      url: z.string().url().describe("The page URL to screenshot."),
      fullPage: z
        .boolean()
        .default(false)
        .describe("Capture the full scrollable page instead of just the viewport."),
      timeoutMs: z.number().int().positive().max(120_000).default(30_000),
    },
    async (input) => {
      try {
        const result = await screenshotPage(input);
        return {
          content: [
            { type: "text" as const, text: `Saved screenshot to ${result.path}` },
            { type: "image" as const, data: result.base64, mimeType: "image/png" },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Failed to screenshot ${input.url}: ${(err as Error).message}` }],
        };
      }
    }
  );

  server.tool(
    "close_browser",
    "Close the local browser bridge and free its resources. The persistent profile " +
      "(cookies/sessions) is kept on disk for next time.",
    {},
    async () => {
      const closed = await closeBrowserContext();
      return {
        content: [{ type: "text" as const, text: closed ? "Browser bridge closed." : "Browser bridge was not running." }],
      };
    }
  );

  return server;
}
