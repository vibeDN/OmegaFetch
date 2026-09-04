import { randomUUID } from "node:crypto";
import type { Response } from "express";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidRequestError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

// A single access token stays valid this long before the phone has to log in again.
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

class InMemoryClientsStore implements OAuthRegisteredClientsStore {
  private readonly clients = new Map<string, OAuthClientInformationFull>();

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return this.clients.get(clientId);
  }

  registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">
  ): OAuthClientInformationFull {
    const full: OAuthClientInformationFull = {
      ...client,
      client_id: randomUUID(),
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    this.clients.set(full.client_id, full);
    return full;
  }
}

interface PendingAuthorization {
  client: OAuthClientInformationFull;
  params: AuthorizationParams;
}

interface StoredToken {
  clientId: string;
  scopes: string[];
  expiresAt: number;
  resource?: URL;
}

function escapeHtml(input: string): string {
  const escapes: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return input.replace(/[&<>"']/g, (ch) => escapes[ch] ?? ch);
}

function renderLoginPage(pendingId: string, clientName: string, error?: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OmegaFetch login</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0b0d12; color: #e7e9ee; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    form { background: #151822; padding: 2rem; border-radius: 12px; width: 320px; max-width: 90vw; box-shadow: 0 10px 40px rgba(0,0,0,.4); }
    h1 { font-size: 1.1rem; margin: 0 0 .25rem; }
    p { color: #9aa3b2; font-size: .85rem; margin: 0 0 1.25rem; }
    input { width: 100%; box-sizing: border-box; padding: .7rem .8rem; border-radius: 8px; border: 1px solid #2a2f3d; background: #0b0d12; color: #e7e9ee; font-size: 1rem; }
    button { width: 100%; margin-top: 1rem; padding: .7rem .8rem; border-radius: 8px; border: none; background: #5b8cff; color: white; font-size: 1rem; cursor: pointer; }
    button:hover { background: #4a76e0; }
    .error { color: #ff6b6b; font-size: .85rem; margin: .5rem 0 0; }
  </style>
</head>
<body>
  <form method="POST" action="/authorize/confirm">
    <h1>OmegaFetch</h1>
    <p>${escapeHtml(clientName)} wants to use your browser bridge.</p>
    <input type="hidden" name="pending_id" value="${escapeHtml(pendingId)}" />
    <input type="password" name="password" placeholder="Password" autofocus required />
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    <button type="submit">Allow</button>
  </form>
</body>
</html>`;
}

/**
 * A minimal single-user OAuth 2.1 authorization server for OmegaFetch.
 *
 * Dynamic client registration is left open (that's normal for MCP connectors —
 * the app registering itself isn't the security boundary). The actual gate is
 * the password prompt in `authorize()`: nobody gets an authorization code, and
 * therefore never a token, without it. Everything is kept in memory, so a
 * server restart requires logging in again from the phone — an acceptable
 * trade for not having to think about a token database.
 */
export class OmegaFetchAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore = new InMemoryClientsStore();
  private readonly pending = new Map<string, PendingAuthorization>();
  private readonly codes = new Map<string, PendingAuthorization>();
  private readonly tokens = new Map<string, StoredToken>();

  constructor(private readonly password: string) {}

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    if (!client.redirect_uris.includes(params.redirectUri)) {
      throw new InvalidRequestError("Unregistered redirect_uri");
    }
    const pendingId = randomUUID();
    this.pending.set(pendingId, { client, params });
    res.type("html").send(renderLoginPage(pendingId, client.client_name ?? client.client_id));
  }

  /** Handles the POST from the login form rendered by authorize(). */
  async handleLoginSubmit(pendingId: string | undefined, password: string | undefined, res: Response): Promise<void> {
    const entry = pendingId ? this.pending.get(pendingId) : undefined;
    if (!entry || !pendingId) {
      res.status(400).type("html").send("<p>Login expired — go back to the app and connect again.</p>");
      return;
    }
    if (password !== this.password) {
      res
        .status(401)
        .type("html")
        .send(renderLoginPage(pendingId, entry.client.client_name ?? entry.client.client_id, "Wrong password."));
      return;
    }
    this.pending.delete(pendingId);

    const code = randomUUID();
    this.codes.set(code, entry);
    const target = new URL(entry.params.redirectUri);
    target.searchParams.set("code", code);
    if (entry.params.state !== undefined) target.searchParams.set("state", entry.params.state);
    res.redirect(target.toString());
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const entry = this.codes.get(authorizationCode);
    if (!entry) throw new Error("Invalid authorization code");
    return entry.params.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<OAuthTokens> {
    const entry = this.codes.get(authorizationCode);
    if (!entry) throw new Error("Invalid authorization code");
    if (entry.client.client_id !== client.client_id) {
      throw new Error("Authorization code was not issued to this client");
    }
    this.codes.delete(authorizationCode);

    const token = randomUUID();
    const expiresAt = Date.now() + TOKEN_TTL_MS;
    this.tokens.set(token, {
      clientId: client.client_id,
      scopes: entry.params.scopes ?? [],
      expiresAt,
      resource: entry.params.resource,
    });
    return {
      access_token: token,
      token_type: "bearer",
      expires_in: Math.floor(TOKEN_TTL_MS / 1000),
      scope: (entry.params.scopes ?? []).join(" "),
    };
  }

  async exchangeRefreshToken(): Promise<OAuthTokens> {
    throw new Error("Refresh tokens aren't supported — log in with the password again once the session expires.");
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const data = this.tokens.get(token);
    if (!data || data.expiresAt < Date.now()) {
      throw new Error("Invalid or expired token");
    }
    return {
      token,
      clientId: data.clientId,
      scopes: data.scopes,
      expiresAt: Math.floor(data.expiresAt / 1000),
      resource: data.resource,
    };
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    this.tokens.delete(request.token);
  }
}
