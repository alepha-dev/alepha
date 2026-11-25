ALTER TABLE "host_jobs" ADD COLUMN "turns" integer;--> statement-breakpoint
ALTER TABLE "host_jobs" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "host_jobs" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "host_jobs" ADD COLUMN "cost_usd" double precision;