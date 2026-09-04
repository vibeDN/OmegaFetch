# OmegaFetch

Lets AI chatbots fetch unfetchable websites.

An MCP server that runs **on your own device** and gives an AI chatbot a
real browser bridge. When a plain HTTP fetch gets blocked — Cloudflare
checks, JS-only single-page apps, login-gated pages, anything that treats a
server-side scraper differently from an actual visitor — OmegaFetch falls
back to driving a real Chromium instance from your machine, with your IP,
your fingerprint, and a persistent cookie/session profile that survives
across calls.

## How it works

1. `fetch_page` first tries a fast, cheap raw HTTP request.
2. If that request is blocked, empty, or looks like a bot-challenge page
   (403/429/503, Cloudflare/captcha markers, or a JS shell with almost no
   visible text), it automatically falls back to opening the URL in a real
   local browser instead.
3. The browser context is **persistent** — it's stored on disk at
   `~/.omegafetch/profile` by default, so if you log into a site once
   through the tool, that session sticks around for next time.
4. The page content is run through [Readability](https://github.com/mozilla/readability)
   to strip nav/ads/chrome down to the actual article, then converted to
   markdown (or returned as plain text / raw HTML).

Three tools are exposed:

| Tool | What it does |
| --- | --- |
| `fetch_page` | Fetch a URL's readable content, with automatic browser fallback. |
| `screenshot_page` | Screenshot a page with the local browser — handy for seeing *why* something is blocked. |
| `close_browser` | Shut down the browser bridge to free resources (the saved profile stays on disk). |

## Install

```bash
git clone https://github.com/vibeDN/OmegaFetch.git
cd OmegaFetch
npm install
npm run build
npx playwright install chromium   # first time only
```

## Use with Claude Code

```bash
claude mcp add omegafetch -- node /path/to/OmegaFetch/dist/index.js
```

Or add it directly to your MCP config:

```json
{
  "mcpServers": {
    "omegafetch": {
      "command": "node",
      "args": ["/path/to/OmegaFetch/dist/index.js"]
    }
  }
}
```

## Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `OMEGAFETCH_PROFILE_DIR` | `~/.omegafetch/profile` | Where the persistent browser profile (cookies, local storage, logins) is stored. |
| `OMEGAFETCH_HEADLESS` | `true` | Set to `0`/`false` to run the browser bridge headed — useful if a site still challenges headless Chromium. |
| `OMEGAFETCH_CHANNEL` | *(bundled Chromium)* | Set to `chrome` to drive your real installed Google Chrome instead of Playwright's bundled Chromium. |
| `OMEGAFETCH_USER_AGENT` | *(default Chromium UA)* | Override the browser's user agent string. |
| `OMEGAFETCH_LOCALE` | `en-US` | Locale the browser reports. |

## A note on responsible use

The browser bridge runs *on your device*, under *your* network and — if you
point it at your real Chrome profile or log in through it — *your*
sessions. Use it for pages you're actually authorized to view: your own
paid subscriptions, sites you have an account on, content behind a wall
your organization has cleared you for. It's a convenience for letting an AI
read what you can already read, not a tool for mass scraping or bulk
bypassing of paywalls/ToS at scale.

## License

See [LICENSE](LICENSE).
