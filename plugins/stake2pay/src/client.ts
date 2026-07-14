export interface ViewClient {
  viewFunction<T>(
    contractId: string,
    methodName: string,
    args?: Record<string, unknown>,
  ): Promise<T>;
}

interface RpcQueryResponse {
  result?: {
    result?: number[];
    error?: string;
  };
  error?: {
    name?: string;
    message?: string;
    data?: unknown;
    cause?: { name?: string };
  };
}

export class NearRpcClient implements ViewClient {
  constructor(
    private readonly rpcUrl: string,
    private readonly timeoutMs: number = 15000,
  ) {}

  async viewFunction<T>(
    contractId: string,
    methodName: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(this.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "stake2pay",
          method: "query",
          params: {
            request_type: "call_function",
            finality: "final",
            account_id: contractId,
            method_name: methodName,
            args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
          },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`RPC timeout after ${this.timeoutMs}ms calling ${methodName}`);
      }
      throw new Error(
        `RPC request failed calling ${methodName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(`RPC HTTP ${response.status} calling ${methodName}`);
    }

    const payload = (await response.json()) as RpcQueryResponse;

    if (payload.error) {
      throw new Error(
        `RPC error calling ${methodName}: ${payload.error.message ?? payload.error.name ?? "unknown"}`,
      );
    }

    if (payload.result?.error) {
      throw new Error(`View call ${methodName} failed: ${payload.result.error}`);
    }

    const bytes = payload.result?.result;
    if (!bytes) {
      throw new Error(`RPC response for ${methodName} contained no result`);
    }

    return JSON.parse(Buffer.from(bytes).toString("utf8")) as T;
  }
}
