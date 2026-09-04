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

## Use from a phone (remote / official Claude app)

The setup above only works with clients that spawn a local process next to
them (Claude Desktop, Claude Code, Cursor...). A phone app can't do that —
it needs a URL. OmegaFetch can also run as a **remote MCP server** over
Streamable HTTP, behind OAuth, so the official Claude mobile app can connect
to it as a custom connector while the actual browser bridge still runs on
a machine you control (e.g. a home PC or server that's always on) — not
some datacenter box, so you keep your real IP and sessions.

**1. Start OmegaFetch in HTTP mode** on the always-on machine:

```bash
OMEGAFETCH_TRANSPORT=http \
OMEGAFETCH_PASSWORD="pick a strong password" \
OMEGAFETCH_PUBLIC_URL="https://omegafetch.yourdomain.com" \
node dist/index.js
```

`OMEGAFETCH_PUBLIC_URL` must match whatever hostname your tunnel exposes —
it's used both as the OAuth issuer and to build redirect URLs, so it has to
be correct before you connect. By default it binds to `127.0.0.1:3939`
(override with `OMEGAFETCH_HOST` / `OMEGAFETCH_PORT`).

**2. Expose it to the internet with a tunnel.** OmegaFetch itself only
speaks plain HTTP on localhost — something else needs to terminate TLS and
forward traffic in. Two easy options:

```bash
# Cloudflare Tunnel (no account changes to your router needed)
cloudflared tunnel --url http://127.0.0.1:3939

# or Tailscale Funnel, if you're already on a tailnet
tailscale funnel 3939
```

Whichever URL the tunnel gives you is what you set as `OMEGAFETCH_PUBLIC_URL`
(restart OmegaFetch if you change it).

**3. Add it as a connector in the Claude app** (claude.ai/desktop/mobile
settings → Connectors → Add custom connector), pointing at
`https://omegafetch.yourdomain.com/mcp`. Claude will walk you through an
OAuth login — that's the password you set in step 1. Nobody gets a token
without it, since dynamic client registration is intentionally open (that's
normal for MCP) but the login screen is the real gate.

**Security notes, read before exposing this to the internet:**
- Pick a real password (`OMEGAFETCH_PASSWORD`), not something guessable —
  it's the only thing standing between a stranger and your browser.
- Tokens live in memory for 12 hours and reset on restart; there's no
  refresh-token support on purpose, so a compromised token expires on its own.
- Anyone who gets a valid token can drive the browser bridge and its
  cookie jar — treat the URL and password like you would a VPN credential.
- This is a single-user hobby setup: no rate limiting, no audit log. Don't
  point it at a profile logged into anything you wouldn't want exposed if
  the password leaked.

## Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `OMEGAFETCH_PROFILE_DIR` | `~/.omegafetch/profile` | Where the persistent browser profile (cookies, local storage, logins) is stored. |
| `OMEGAFETCH_HEADLESS` | `true` | Set to `0`/`false` to run the browser bridge headed — useful if a site still challenges headless Chromium. |
| `OMEGAFETCH_CHANNEL` | *(bundled Chromium)* | Set to `chrome` to drive your real installed Google Chrome instead of Playwright's bundled Chromium. |
| `OMEGAFETCH_EXECUTABLE_PATH` | — | Path to a Chromium-based browser binary that isn't a Playwright "channel" — e.g. Brave, Vivaldi. Takes priority over `OMEGAFETCH_CHANNEL`. Typical Brave paths: `/usr/bin/brave-browser` (Linux), `/Applications/Brave Browser.app/Contents/MacOS/Brave Browser` (macOS), `C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe` (Windows). |
| `OMEGAFETCH_USER_AGENT` | *(default Chromium UA)* | Override the browser's user agent string. |
| `OMEGAFETCH_LOCALE` | `en-US` | Locale the browser reports. |
| `OMEGAFETCH_TRANSPORT` | `stdio` | Set to `http` to run as a remote OAuth-protected MCP server instead of talking stdio to a local client. See "Use from a phone" above. |
| `OMEGAFETCH_PASSWORD` | — | Required in `http` mode. The password gating the OAuth login screen. |
| `OMEGAFETCH_PUBLIC_URL` | — | Required in `http` mode. The public HTTPS URL your tunnel exposes (used as the OAuth issuer). |
| `OMEGAFETCH_HOST` | `127.0.0.1` | `http` mode only — bind address. |
| `OMEGAFETCH_PORT` | `3939` | `http` mode only — bind port. |

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
