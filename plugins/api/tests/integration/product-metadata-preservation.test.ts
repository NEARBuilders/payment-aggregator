import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearProducts, createTestProduct } from "../helpers";
import { getPluginClient, runMigrations, teardown } from "../setup";

const ADMIN_CONTEXT = {
  nearAccountId: "admin.near",
  user: {
    id: "admin-user",
    role: "admin" as const,
    email: "admin@nearmerch.com",
    name: "Admin User",
  },
};

describe("product metadata preservation", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await teardown();
  });

  beforeEach(async () => {
    await clearProducts();
  });

  afterEach(async () => {
    await clearProducts();
  });

  it("preserves existing providerDetails when metadata is updated", async () => {
    await createTestProduct("prod_meta", {
      name: "Metadata Product",
      fulfillmentProvider: "manual",
      metadata: {
        fees: [],
        creatorAccountId: "creator.near",
        providerDetails: {
          printful: {
            brand: "Near Merch",
            model: "Classic Tee",
          },
          manual: {
            notificationEmails: ["ops@nearmerch.com"],
            ownerAccountIds: ["owner.near"],
            replyToEmail: "support@nearmerch.com",
          },
        },
      },
    });

    const adminClient = await getPluginClient(ADMIN_CONTEXT);

    await adminClient.updateProductMetadata({
      id: "prod_meta",
      metadata: {
        fees: [
          {
            type: "royalty",
            label: "Artist",
            recipient: "artist.near",
            bps: 500,
          },
        ],
        creatorAccountId: "updated-creator.near",
      },
    });

    const result = await adminClient.getAdminProduct({ id: "prod_meta" });

    expect(result.product.metadata).toMatchObject({
      creatorAccountId: "updated-creator.near",
      fees: [
        {
          label: "Artist",
          recipient: "artist.near",
          bps: 500,
        },
      ],
      providerDetails: {
        printful: {
          brand: "Near Merch",
          model: "Classic Tee",
        },
        manual: {
          notificationEmails: ["ops@nearmerch.com"],
          ownerAccountIds: ["owner.near"],
          replyToEmail: "support@nearmerch.com",
        },
      },
    });
  });
});
