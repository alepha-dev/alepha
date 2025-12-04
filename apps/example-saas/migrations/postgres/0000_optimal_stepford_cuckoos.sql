CREATE TABLE "saas"."identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"password" text,
	"provider" text NOT NULL,
	"provider_user_id" text,
	"provider_data" jsonb
);
--> statement-breakpoint
CREATE TABLE "saas"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"template" text NOT NULL,
	"category" text,
	"critical" boolean,
	"sensitive" boolean,
	"contact" text NOT NULL,
	"variables" jsonb,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"error" jsonb
);
--> statement-breakpoint
CREATE TABLE "saas"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"refresh_token" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" jsonb
);
--> statement-breakpoint
CREATE TABLE "saas"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"realm" text DEFAULT 'default' NOT NULL,
	"username" text,
	"email" text,
	"phone_number" text,
	"roles" text[] DEFAULT '{}' NOT NULL,
	"first_name" text,
	"last_name" text,
	"picture" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saas"."verification" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "saas"."verification_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"type" text NOT NULL,
	"target" text NOT NULL,
	"code" text NOT NULL,
	"verified_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saas"."identities" ADD CONSTRAINT "identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "saas"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saas"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "saas"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_realm_username_idx" ON "saas"."users" USING btree ("realm","username");--> statement-breakpoint
CREATE UNIQUE INDEX "users_realm_email_idx" ON "saas"."users" USING btree ("realm","email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_realm_phone_number_idx" ON "saas"."users" USING btree ("realm","phone_number");--> statement-breakpoint
CREATE INDEX "verification_created_at_idx" ON "saas"."verification" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "verification_target_code_idx" ON "saas"."verification" USING btree ("target","code");