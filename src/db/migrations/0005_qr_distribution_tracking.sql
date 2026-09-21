CREATE TYPE "public"."qr_distribution_status" AS ENUM('NOT_DISTRIBUTED', 'DISTRIBUTED');--> statement-breakpoint
ALTER TABLE "qr_codes" ADD COLUMN "distribution_status" "qr_distribution_status" DEFAULT 'NOT_DISTRIBUTED' NOT NULL;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD COLUMN "distributed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "qr_codes_distribution_status_idx" ON "qr_codes" USING btree ("distribution_status");--> statement-breakpoint
ALTER TABLE "qr_batches" ADD CONSTRAINT "qr_batches_quantity_range" CHECK ("qr_batches"."quantity" > 0 and "qr_batches"."quantity" <= 2000);