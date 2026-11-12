CREATE TABLE "alepha_sequences" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"scope" text DEFAULT 'default' NOT NULL,
	"value" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "views" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "views_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "alepha_sequences_name_scope_idx" ON "alepha_sequences" ("name","scope");--> statement-breakpoint
CREATE UNIQUE INDEX "name_idx" ON "views" ("name");