CREATE TABLE "entitlement_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"entitlement_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_transactions_type_check" CHECK ("entitlement_transactions"."type" IN ('grant', 'consume'))
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"credit_type" text DEFAULT 'default' NOT NULL,
	"balance" numeric DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlements_user_org_type_unique" UNIQUE NULLS NOT DISTINCT("user_id","organization_id","credit_type")
);
--> statement-breakpoint
ALTER TABLE "entitlement_transactions" ADD CONSTRAINT "entitlement_transactions_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_transactions_source_ref_unique" ON "entitlement_transactions" USING btree ("source_ref");