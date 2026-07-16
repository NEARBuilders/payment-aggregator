import { afterAll, describe, expect, it } from "vitest";
import { getPluginClient, teardown } from "../setup";

const FRESH_ACCOUNT = "stake2pay-fresh-account-e2e.testnet";

describe.skipIf(process.env.SKIP_HOS_TESTNET === "1")(
  "stake2pay plugin against HoS testnet (read-only)",
  () => {
    afterAll(async () => {
      await teardown();
    });

    it("responds to ping", async () => {
      const client = await getPluginClient();
      const result = await client.ping();
      expect(result.provider).toBe("stake2pay");
      expect(result.status).toBe("ok");
    });

    it("exposes provider metadata", async () => {
      const client = await getPluginClient();
      const metadata = await client.metadata();
      expect(metadata.name).toBe("Stake2Pay");
      expect(metadata.description.length).toBeGreaterThan(0);
    });

    it("lists the seeded recurring tiers with NEAR ranges", async () => {
      const client = await getPluginClient();
      const plans = await client.listPlans();

      expect(plans.length).toBeGreaterThanOrEqual(3);
      for (const plan of plans) {
        expect(plan.id).toMatch(/^price_/);
        expect(plan.currency).toBe("NEAR");
        expect(plan.period).toBe("monthly");
        expect(BigInt(plan.minAmount) <= BigInt(plan.maxAmount)).toBe(true);
        expect(BigInt(plan.minAmount) > 0n).toBe(true);
      }
    });

    it("returns status none for a fresh account", async () => {
      const client = await getPluginClient();
      const plans = await client.listPlans();
      const planId = plans[0]?.id;
      if (!planId) throw new Error("no plans on testnet contract");

      const subscription = await client.getSubscription({
        planId,
        payerRef: FRESH_ACCOUNT,
      });
      expect(subscription.status).toBe("none");
      expect(subscription.payerRef).toBe(FRESH_ACCOUNT);
    });

    it("builds a signable wallet intent for a new subscription", async () => {
      const client = await getPluginClient();
      const plans = await client.listPlans();
      const plan = plans[0];
      if (!plan) throw new Error("no plans on testnet contract");

      const action = await client.createSubscription({
        planId: plan.id,
        amount: plan.minAmount,
        payerRef: FRESH_ACCOUNT,
      });

      if (action.kind !== "wallet_intent") throw new Error("expected wallet_intent");
      expect(action.networkId).toBe("testnet");
      expect(action.contractId).toBe("hos-e2e-0601144939.testnet");

      const lockAction = action.actions.at(-1);
      expect(lockAction).toMatchObject({
        methodName: "lock",
        args: { price_id: plan.id, duration_ns: null },
        deposit: plan.minAmount,
      });
      expect(lockAction?.gas).toBe("300000000000000");

      for (const walletAction of action.actions) {
        expect(BigInt(walletAction.gas) <= 300_000_000_000_000n).toBe(true);
      }
    });

    it("rejects an out-of-range stake amount", async () => {
      const client = await getPluginClient();
      const plans = await client.listPlans();
      const plan = plans[0];
      if (!plan) throw new Error("no plans on testnet contract");

      await expect(
        client.createSubscription({
          planId: plan.id,
          amount: (BigInt(plan.maxAmount) + 1n).toString(),
          payerRef: FRESH_ACCOUNT,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("returns NOT_FOUND for an unknown plan", async () => {
      const client = await getPluginClient();
      await expect(
        client.getSubscription({ planId: "price_does_not_exist", payerRef: FRESH_ACCOUNT }),
      ).resolves.toMatchObject({ status: "none" });

      await expect(
        client.createSubscription({ planId: "price_does_not_exist", payerRef: FRESH_ACCOUNT }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("returns NOT_FOUND when cancelling without a subscription", async () => {
      const client = await getPluginClient();
      const plans = await client.listPlans();
      const planId = plans[0]?.id;
      if (!planId) throw new Error("no plans on testnet contract");

      await expect(
        client.cancelSubscription({ planId, payerRef: FRESH_ACCOUNT }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  },
);
