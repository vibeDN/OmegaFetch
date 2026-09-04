#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";
import { closeBrowserContext } from "./browser.js";

async function runStdio(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function main(): Promise<void> {
  if (process.env.OMEGAFETCH_TRANSPORT === "http") {
    const { startHttpServer } = await import("./httpServer.js");
    await startHttpServer();
    return;
  }
  await runStdio();
}

main().catch((err) => {
  console.error("OmegaFetch fatal error:", err);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await closeBrowserContext().catch(() => {});
    process.exit(0);
  });
}
