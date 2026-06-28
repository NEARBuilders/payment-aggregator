ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "storage_key" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "size" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_storage_key_idx" ON "assets" USING btree ("storage_key");
