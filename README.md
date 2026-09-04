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

## Use from a phone (remote MCP)

The setup above only works with clients that spawn a local process next to
them (Claude Desktop, Claude Code, Cursor...). A phone app can't do that —
it needs a URL. OmegaFetch can also run as a **remote MCP server** over
Streamable HTTP, protected by a single static bearer token (no OAuth
dance, no login page, no dynamic client registration — just a personal
API key), while the actual browser bridge still runs on a machine you
control (e.g. a home PC or server that's always on) — not some datacenter
box, so you keep your real IP and sessions.

**1. Pick a token and start OmegaFetch in HTTP mode** on the always-on
machine:

```bash
# generate one:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

OMEGAFETCH_TRANSPORT=http \
OMEGAFETCH_TOKEN="<the token you generated>" \
node dist/index.js
```

By default it binds to `127.0.0.1:3939` (override with `OMEGAFETCH_HOST` /
`OMEGAFETCH_PORT`).

**2. Expose it to the internet with a tunnel.** OmegaFetch itself only
speaks plain HTTP on localhost — something else needs to terminate TLS and
forward traffic in. Two easy options:

```bash
# Cloudflare Tunnel (no router changes needed)
cloudflared tunnel --url http://127.0.0.1:3939

# or Tailscale Funnel, if you're already on a tailnet
tailscale funnel 3939
```

If the tunnel forwards a hostname other than `localhost`/`127.0.0.1` (it
usually will), add it to `OMEGAFETCH_ALLOWED_HOSTS` (comma-separated) so
OmegaFetch's DNS-rebinding protection accepts requests for it — e.g.
`OMEGAFETCH_ALLOWED_HOSTS=omegafetch.yourdomain.com`.

**3. Point your MCP client at `https://<tunnel-host>/mcp`** and configure it
to send `Authorization: Bearer <the token from step 1>` on every request —
whatever field your client calls it (custom header, API key, bearer token).
No further handshake needed: the right token gets straight in, the wrong
one (or none) gets a 401.

**Security notes, read before exposing this to the internet:**
- Generate the token, don't type one — `OMEGAFETCH_TOKEN` is the *only*
  thing standing between a stranger and your browser bridge.
- There's no expiry or rotation built in. If the token leaks, restart with
  a new one — everyone using the old one is immediately locked out.
- Anyone who has the token can drive the browser bridge and its cookie
  jar — treat it like a VPN credential, not something you paste into a chat.
- This is a single-user hobby setup: no rate limiting, no audit log. Don't
  point it at a browser profile logged into anything you wouldn't want
  exposed if the token leaked.

## Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `OMEGAFETCH_PROFILE_DIR` | `~/.omegafetch/profile` | Where the persistent browser profile (cookies, local storage, logins) is stored. |
| `OMEGAFETCH_HEADLESS` | `true` | Set to `0`/`false` to run the browser bridge headed — useful if a site still challenges headless Chromium. |
| `OMEGAFETCH_CHANNEL` | *(bundled Chromium)* | Set to `chrome` to drive your real installed Google Chrome instead of Playwright's bundled Chromium. |
| `OMEGAFETCH_EXECUTABLE_PATH` | — | Path to a Chromium-based browser binary that isn't a Playwright "channel" — e.g. Brave, Vivaldi. Takes priority over `OMEGAFETCH_CHANNEL`. Typical Brave paths: `/usr/bin/brave-browser` (Linux), `/Applications/Brave Browser.app/Contents/MacOS/Brave Browser` (macOS), `C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe` (Windows). |
| `OMEGAFETCH_USER_AGENT` | *(default Chromium UA)* | Override the browser's user agent string. |
| `OMEGAFETCH_LOCALE` | `en-US` | Locale the browser reports. |
| `OMEGAFETCH_TRANSPORT` | `stdio` | Set to `http` to run as a remote bearer-token-protected MCP server instead of talking stdio to a local client. See "Use from a phone" above. |
| `OMEGAFETCH_TOKEN` | — | Required in `http` mode. The static bearer token clients must send. |
| `OMEGAFETCH_HOST` | `127.0.0.1` | `http` mode only — bind address. |
| `OMEGAFETCH_PORT` | `3939` | `http` mode only — bind port. |
| `OMEGAFETCH_ALLOWED_HOSTS` | `localhost`, `127.0.0.1` | `http` mode only — comma-separated hostnames to accept (add your tunnel's public hostname). |

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
