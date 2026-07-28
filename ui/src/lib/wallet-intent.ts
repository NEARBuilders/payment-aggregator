import type { AuthClient } from "@/app";

export type WalletIntent = {
  kind: "wallet_intent";
  networkId: string;
  contractId: string;
  actions: Array<{
    methodName: string;
    args: Record<string, unknown>;
    deposit: string;
    gas: string;
  }>;
};

export type SubscriptionInfo = {
  id?: string;
  planId: string;
  status: "active" | "cancel_at_period_end" | "pending_unstake" | "ended" | "none";
  amount?: string;
  currency?: string;
  currentPeriodEnd?: string;
  payerRef: string;
  metadata?: Record<string, string>;
};

export type SubscriptionAction =
  | WalletIntent
  | { kind: "redirect"; url: string }
  | { kind: "executed"; subscription: SubscriptionInfo };

export async function signWalletIntent(authClient: AuthClient, intent: WalletIntent) {
  const connected = await authClient.near.ensureConnected();
  if (!connected) {
    throw new Error("Connect a NEAR wallet to sign this transaction");
  }
  const accountId = authClient.near.getAccountId();
  if (!accountId) {
    throw new Error("No NEAR account linked to this session");
  }
  const network = authClient.near.getNetwork();
  if (network !== intent.networkId) {
    throw new Error(`Wallet is on ${network}, but this subscription needs ${intent.networkId}`);
  }

  // max_total_prepaid_gas is 1000 Tgas as of protocol v84/v85 (verified via
  // EXPERIMENTAL_protocol_config); intents exceeding it sign as sequential txs.
  const totalGas = intent.actions.reduce((sum, action) => sum + BigInt(action.gas), 0n);
  const batches =
    totalGas <= 1_000_000_000_000_000n
      ? [intent.actions]
      : intent.actions.map((action) => [action]);

  for (const batch of batches) {
    let tx = authClient.near.client.transaction(accountId);
    for (const action of batch) {
      tx = tx.functionCall(intent.contractId, action.methodName, action.args, {
        gas: action.gas as `${number}`,
        attachedDeposit: BigInt(action.deposit),
      });
    }
    await tx.send();
  }
}
