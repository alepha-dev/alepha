CREATE TABLE "batch_guards" (
	"id" text PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_guards_valid_id" CHECK (id IS NOT NULL)
);
