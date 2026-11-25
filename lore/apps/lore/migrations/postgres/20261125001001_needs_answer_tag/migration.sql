-- The Asks tag is `needs-answer` (#Q4279), spelled like `needs-human`: the
-- stored quests carrying `need-answer` take the new spelling, once even when
-- both are there, in every project.
UPDATE "quests" SET "tags" = ARRAY(SELECT DISTINCT CASE WHEN t = 'need-answer' THEN 'needs-answer' ELSE t END FROM unnest("tags") AS t)
WHERE 'need-answer' = ANY("tags");--> statement-breakpoint
-- A project's tag colour keyed by the old spelling moves to the new one,
-- unless the new one has a colour of its own.
UPDATE "projects" SET "tag_colors" = jsonb_set("tag_colors", '{needs-answer}', "tag_colors" -> 'need-answer')
WHERE "tag_colors" ? 'need-answer' AND NOT "tag_colors" ? 'needs-answer';--> statement-breakpoint
UPDATE "projects" SET "tag_colors" = "tag_colors" - 'need-answer'
WHERE "tag_colors" ? 'need-answer';
