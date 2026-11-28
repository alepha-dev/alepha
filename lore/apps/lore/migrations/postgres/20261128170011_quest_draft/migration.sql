-- A quest can be a draft (#Q4372, epic #E178): `draft_at` is set while it is
-- one, `ready_at` stamped when it leaves draft. Both nullable with no default,
-- so this is two additive ADD COLUMNs and never a rebuild of `quests`.
ALTER TABLE "quests" ADD COLUMN "draft_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "ready_at" timestamp with time zone;