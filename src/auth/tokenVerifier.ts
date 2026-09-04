import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

// The bearer-auth middleware requires a concrete expiry, so a "never expires"
// static token just gets one recomputed 10 years out on every check.
const EXPIRES_IN_SECONDS = 10 * 365 * 24 * 60 * 60;

/**
 * Single static bearer token, for personal use — no OAuth dance, no dynamic
 * client registration, no login page. Set OMEGAFETCH_TOKEN once and hand
 * that exact string to whatever MCP client is calling in as its Bearer
 * token.
 */
export class StaticTokenVerifier implements OAuthTokenVerifier {
  constructor(private readonly token: string) {}

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (token !== this.token) {
      throw new InvalidTokenError("Invalid token");
    }
    return {
      token,
      clientId: "personal",
      scopes: ["mcp"],
      expiresAt: Math.floor(Date.now() / 1000) + EXPIRES_IN_SECONDS,
    };
  }
}
