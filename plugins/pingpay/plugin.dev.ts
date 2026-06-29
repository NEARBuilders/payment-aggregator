import "dotenv/config";
import type { PluginConfigInput } from "every-plugin";
import packageJson from "./package.json" with { type: "json" };
import type Plugin from "./src/index";

export default {
  pluginId: packageJson.name,
  port: Number(process.env.PORT) || 3015,
  config: {
    variables: {
      baseUrl: "https://pay.pingpay.io",
      recipientAddress: process.env.PING_RECIPIENT_ADDRESS || "near-merch-store.near",
    },
    secrets: {
      PING_API_KEY: process.env.PING_API_KEY,
      PING_WEBHOOK_SECRET: process.env.PING_WEBHOOK_SECRET,
    },
  } satisfies PluginConfigInput<typeof Plugin>,
};
