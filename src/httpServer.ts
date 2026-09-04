import express from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { OmegaFetchAuthProvider } from "./auth/provider.js";
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
 * Runs OmegaFetch as a remote (Streamable HTTP) MCP server behind OAuth, so a
 * phone-based MCP client — not just a local desktop process — can reach the
 * browser bridge running on this machine. Meant to sit behind a tunnel
 * (Cloudflare Tunnel, Tailscale Funnel, ...) that terminates TLS and forwards
 * to this port; OmegaFetch itself only speaks plain HTTP on localhost.
 */
export async function startHttpServer(): Promise<void> {
  const password = requireEnv("OMEGAFETCH_PASSWORD");
  const publicUrl = new URL(requireEnv("OMEGAFETCH_PUBLIC_URL"));
  const port = Number(process.env.OMEGAFETCH_PORT ?? 3939);
  const bindHost = process.env.OMEGAFETCH_HOST ?? "127.0.0.1";

  const provider = new OmegaFetchAuthProvider(password);
  const resourceServerUrl = new URL("/mcp", publicUrl);

  const app = createMcpExpressApp({
    host: bindHost,
    allowedHosts: [publicUrl.host, "localhost", "127.0.0.1", `127.0.0.1:${port}`],
  });

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: publicUrl,
      resourceServerUrl,
      resourceName: "OmegaFetch",
      scopesSupported: ["mcp"],
    })
  );

  app.post("/authorize/confirm", express.urlencoded({ extended: false }), async (req, res) => {
    await provider.handleLoginSubmit(req.body.pending_id, req.body.password, res);
  });

  const bearerAuth = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceServerUrl),
  });

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
    console.log(`OmegaFetch listening on http://${bindHost}:${port} (public: ${publicUrl.origin})`);
    console.log("Point your tunnel at this port; add the public URL as a connector in the Claude app.");
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      await closeBrowserContext().catch(() => {});
      process.exit(0);
    });
  }
}
