import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { ContractType } from "./contract";

export interface PayClientOptions {
  apiKey?: string;
}

export function createPayClient(baseUrl: string, options?: PayClientOptions) {
  const url = `${baseUrl.replace(/\/$/, "")}/api/rpc`;

  const headers: Record<string, string> = {};
  if (options?.apiKey) {
    headers["x-api-key"] = options.apiKey;
  }

  const link = new RPCLink({
    url,
    headers,
    fetch: (requestUrl, requestOptions) =>
      fetch(requestUrl, { ...requestOptions, credentials: "include" }),
  });

  return createORPCClient(link) as ContractRouterClient<ContractType>;
}
