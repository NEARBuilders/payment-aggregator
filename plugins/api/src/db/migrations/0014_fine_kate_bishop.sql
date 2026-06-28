CREATE TABLE "provider_test_states" (
	"provider" text PRIMARY KEY NOT NULL,
	"test_product_id" text,
	"selected_rates" jsonb,
	"scenario" jsonb,
	"latest_order_id" text,
	"latest_step_results" jsonb,
	"latest_webhook_payloads" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "provider_test_states_updated_idx" ON "provider_test_states" USING btree ("updated_at");