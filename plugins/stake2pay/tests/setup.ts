import { createServer } from "node:http";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { RPCHandler } from "@orpc/server/node";
import { createPluginRuntime } from "every-plugin";
import type { SubscriptionContract } from "@/contract";
import Plugin from "@/index";
import pluginDevConfig from "../plugin.dev";

const TEST_PLUGIN_ID = pluginDevConfig.pluginId;
const TEST_CONFIG = pluginDevConfig.config;

const TEST_REGISTRY = {
  [TEST_PLUGIN_ID]: {
    module: Plugin,
    description: "Integration test runtime",
  },
} as const;

export const runtime = createPluginRuntime({
  registry: TEST_REGISTRY,
  secrets: {},
});

let server: ReturnType<typeof createServer> | null = null;
let baseUrl = "";
let port = 0;

export async function getPluginClient() {
  if (!server) {
    const { router } = (await runtime.usePlugin(TEST_PLUGIN_ID, TEST_CONFIG)) as any;
    const rpcHandler = new RPCHandler(router);

    port = 3000 + Math.floor(Math.random() * 1000);
    baseUrl = `http://localhost:${port}`;

    server = createServer(async (req, res) => {
      const url = new URL(req.url!, baseUrl);

      if (url.pathname.startsWith("/rpc")) {
        const result = await rpcHandler.handle(req, res, {
          prefix: "/rpc",
          context: {},
        });
        if (result.matched) return;
      }

      res.statusCode = 404;
      res.end("Route not found");
    });

    await new Promise<void>((resolve, reject) => {
      server?.listen(port, "127.0.0.1", () => resolve());
      server?.on("error", reject);
    });
  }

  const link = new RPCLink({
    url: `${baseUrl}/rpc`,
    fetch: globalThis.fetch,
  });

  const client: ContractRouterClient<typeof SubscriptionContract> = createORPCClient(link);
  return client;
}

export async function teardown() {
  if (server) {
    await new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
    server = null;
  }
  await runtime.shutdown();
}
