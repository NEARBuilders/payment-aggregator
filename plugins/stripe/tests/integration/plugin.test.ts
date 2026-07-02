import { afterAll, describe, expect, it } from "vitest";
import { getPluginClient, teardown } from "../setup";

describe("Stripe Plugin Integration Tests", () => {
  afterAll(async () => {
    await teardown();
  });

  describe("metadata procedure", () => {
    it("should return provider metadata", async () => {
      const client = await getPluginClient();

      const result = await client.metadata();

      expect(result).toEqual({
        name: "Stripe",
        logo: expect.stringContaining("stripe"),
        description: expect.any(String),
      });
    });
  });

  describe("ping procedure", () => {
    it("should return healthy status with provider name", async () => {
      const client = await getPluginClient();

      const result = await client.ping();

      expect(result).toEqual({
        provider: "stripe",
        status: "ok",
        timestamp: expect.any(String),
      });
    });
  });

  describe("getSession procedure", () => {
    it("should return an error for non-existent session", async () => {
      const client = await getPluginClient();

      await expect(client.getSession({ sessionId: "cs_nonexistent" })).rejects.toThrow();
    });
  });
});
