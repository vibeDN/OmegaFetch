import express from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StaticTokenVerifier } from "./auth/tokenVerifier.js";
import { buildServer } from "./server.js";
import { closeBrowserContext } from "./browser.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required for OMEGAFETCH_TRANSPORT=http. See the README's "Use from a phone" section.`
    );
  }
  return value;
}

function methodNotAllowed(res: express.Response) {
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    })
  );
}

/**
 * Runs OmegaFetch as a remote Streamable HTTP MCP server behind a single
 * static bearer token — no OAuth flow, no dynamic client registration, no
 * login page. Meant for personal use: set OMEGAFETCH_TOKEN once and hand
 * that exact string to whatever client is calling in (e.g. as the Bearer
 * token / auth header for a custom connector). Meant to sit behind a tunnel
 * that terminates TLS; OmegaFetch itself only speaks plain HTTP on
 * localhost.
 */
export async function startHttpServer(): Promise<void> {
  const token = requireEnv("OMEGAFETCH_TOKEN");
  const port = Number(process.env.OMEGAFETCH_PORT ?? 3939);
  const bindHost = process.env.OMEGAFETCH_HOST ?? "127.0.0.1";
  const allowedHostsEnv = process.env.OMEGAFETCH_ALLOWED_HOSTS;

  const app = createMcpExpressApp({
    host: bindHost,
    allowedHosts: allowedHostsEnv
      ? allowedHostsEnv.split(",").map((h) => h.trim())
      : ["localhost", "127.0.0.1", `127.0.0.1:${port}`],
  });

  const bearerAuth = requireBearerAuth({ verifier: new StaticTokenVerifier(token) });

  app.post("/mcp", bearerAuth, async (req, res) => {
    const server = buildServer();
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        transport.close();
        server.close();
      });
    } catch (err) {
      console.error("Error handling MCP request:", err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });
  app.get("/mcp", bearerAuth, (_req, res) => methodNotAllowed(res));
  app.delete("/mcp", bearerAuth, (_req, res) => methodNotAllowed(res));

  app.listen(port, bindHost, () => {
    console.log(`OmegaFetch listening on http://${bindHost}:${port}/mcp`);
    console.log("Point your tunnel at this port, and use OMEGAFETCH_TOKEN as the Bearer token in your MCP client.");
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      await closeBrowserContext().catch(() => {});
      process.exit(0);
    });
  }
}
