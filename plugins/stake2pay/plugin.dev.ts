import "dotenv/config";
import type { PluginConfigInput } from "every-plugin";
import packageJson from "./package.json" with { type: "json" };
import type Plugin from "./src/index";

export default {
  pluginId: packageJson.name,
  port: Number(process.env.PORT) || 3016,
  config: {
    variables: {
      rpcUrl: process.env.HOS_RPC_URL || "https://test.rpc.fastnear.com",
      networkId: process.env.HOS_NETWORK_ID || "testnet",
      contractId: process.env.HOS_CONTRACT_ID || "hos-e2e-0601144939.testnet",
      productId: process.env.HOS_PRODUCT_ID || "prod_5lklj46roIwKZK",
    },
    secrets: {},
  } satisfies PluginConfigInput<typeof Plugin>,
};
