-- #E74 / #Q2619: rewrite the two kinds of legacy row, so the read paths that
-- tolerated them can go in the same commit. Migrate runs before deploy, so
-- the new Worker never sees either shape. Both statements are idempotent:
-- on a database with no such row they change nothing.
--
-- 1. An objective without an `id` gets its index in the array, which is the
--    id the read path synthesized for it until now: no visible id changes.
--    Order is kept by sorting on json_each's `key` (the array index).
UPDATE `quests` SET `objectives` = (
  SELECT json_group_array(json(`element`)) FROM (
    SELECT CASE
      WHEN json_extract(`value`, '$.id') IS NULL
      THEN json_set(`value`, '$.id', `key`)
      ELSE `value`
    END AS `element`
    FROM json_each(`quests`.`objectives`)
    ORDER BY `key`
  )
)
WHERE EXISTS (
  SELECT 1 FROM json_each(`quests`.`objectives`)
  WHERE json_extract(`value`, '$.id') IS NULL
);--> statement-breakpoint
-- 2. `tag-change` left the revision action enum, which is validated on read:
--    a row still holding it would fail the whole history query. `edit` is the
--    nearest honest label for a revision that carries a content snapshot;
--    deleting the rows would lose history.
UPDATE `folio_revisions` SET `action` = 'edit' WHERE `action` = 'tag-change';
