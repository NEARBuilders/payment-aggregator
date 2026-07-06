export interface PingRecipient {
  address: string;
}

export interface PingAsset {
  chain: string;
  symbol: string;
}

export interface PingFee {
  type: string;
  label: string;
  recipient: string;
  bps: number;
}

export interface CreateCheckoutSessionInput {
  amount: string;
  recipient: PingRecipient;
  asset: PingAsset;
  successUrl?: string;
  cancelUrl?: string;
  metadata?: Record<string, unknown>;
  fees?: PingFee[];
}

export interface PingAmount {
  assetId: string;
  amount: string;
  decimals: number;
}

export interface PingSuggestedAsset {
  chain: string;
  symbol: string;
  contractAddress: string;
  decimals: number;
  name: string;
}

export interface PingSession {
  sessionId: string;
  status: "CREATED" | "PENDING" | "COMPLETED" | "EXPIRED" | "CANCELLED";
  paymentId?: string | null;
  amount: PingAmount;
  recipient: PingRecipient;
  successUrl?: string;
  cancelUrl?: string;
  createdAt: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
  fees?: PingFee[];
}

export interface CheckoutSessionResponse {
  session: PingSession;
  sessionUrl: string;
}

export interface GetCheckoutSessionResponse {
  session: PingSession;
  config?: {
    suggestedAsset?: PingSuggestedAsset;
  };
}

export class PingPayClient {
  private baseUrl: string;
  private apiKey?: string;
  private testMode: boolean;

  constructor(baseUrl = "https://pay.pingpay.io", apiKey?: string) {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    this.apiKey = apiKey;
    this.testMode = !apiKey || apiKey.startsWith("test_");
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}/api${path}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options?.headers as Record<string, string>),
    };

    if (this.apiKey) {
      headers["x-api-key"] = this.apiKey;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Ping API error: ${response.status} - ${errorBody}`);
    }

    return response.json() as T;
  }

  async ping(): Promise<{ status: "ok"; timestamp: string }> {
    if (this.testMode) {
      return { status: "ok", timestamp: new Date().toISOString() };
    }
    return this.request("/ping");
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSessionResponse> {
    if (this.testMode) {
      const sessionId = `test_session_${Date.now()}`;
      return {
        session: {
          sessionId,
          status: "CREATED",
          paymentId: null,
          amount: {
            assetId: "nep141:test-usdc.near",
            amount: input.amount,
            decimals: 6,
          },
          recipient: { address: input.recipient.address },
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          metadata: input.metadata,
        },
        sessionUrl: `https://pay.pingpay.io/checkout?sessionId=${sessionId}`,
      };
    }
    return this.request("/checkout/sessions", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async getCheckoutSession(sessionId: string): Promise<GetCheckoutSessionResponse> {
    if (this.testMode) {
      return {
        session: {
          sessionId,
          status: "CREATED",
          paymentId: null,
          amount: {
            assetId: "nep141:test-usdc.near",
            amount: "1000000",
            decimals: 6,
          },
          recipient: { address: "test-recipient.near" },
          createdAt: new Date().toISOString(),
          metadata: {},
        },
        config: {
          suggestedAsset: {
            chain: "near",
            symbol: "USDC",
            contractAddress: "test-usdc.near",
            decimals: 6,
            name: "USD Coin",
          },
        },
      };
    }
    return this.request(`/checkout/sessions/${sessionId}`);
  }
}
