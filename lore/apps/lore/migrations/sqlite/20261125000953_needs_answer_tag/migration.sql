-- The Asks tag is `needs-answer` (#Q4279), spelled like `needs-human`: the
-- stored quests carrying `need-answer` take the new spelling, once even when
-- both are there, in every project.
UPDATE `quests` SET `tags` = (SELECT json_group_array(DISTINCT CASE value WHEN 'need-answer' THEN 'needs-answer' ELSE value END) FROM json_each(`tags`))
WHERE EXISTS (SELECT 1 FROM json_each(`tags`) WHERE value = 'need-answer');--> statement-breakpoint
-- A project's tag colour keyed by the old spelling moves to the new one,
-- unless the new one has a colour of its own.
UPDATE `projects` SET `tag_colors` = json_set(`tag_colors`, '$."needs-answer"', json_extract(`tag_colors`, '$."need-answer"'))
WHERE json_extract(`tag_colors`, '$."need-answer"') IS NOT NULL AND json_extract(`tag_colors`, '$."needs-answer"') IS NULL;--> statement-breakpoint
UPDATE `projects` SET `tag_colors` = json_remove(`tag_colors`, '$."need-answer"')
WHERE json_extract(`tag_colors`, '$."need-answer"') IS NOT NULL;
