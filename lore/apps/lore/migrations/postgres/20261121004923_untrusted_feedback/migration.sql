ALTER TABLE "feedback" ADD COLUMN "untrusted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "jobs_runner" text;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "untrusted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "untrusted_confirmed_at" text;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "untrusted_confirmed_by" uuid;--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_untrusted_confirmed_by_users_id_fkey" FOREIGN KEY ("untrusted_confirmed_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
-- #Q3987: feedback already filed by someone who is not a member of its project
-- today is untrusted, as a new one from them would be. Conservative on purpose:
-- membership, not the rank, decides here, and a row with no reporter left
-- (account deleted) is untrusted too.
UPDATE "feedback" SET "untrusted" = true WHERE "reporter_user_id" IS NULL OR NOT EXISTS (SELECT 1 FROM "organization_members" "m" JOIN "projects" "p" ON "p"."organization_id" = "m"."organization_id" WHERE "p"."id" = "feedback"."project_id" AND "m"."user_id" = "feedback"."reporter_user_id");
