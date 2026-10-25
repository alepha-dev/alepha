-- The changelog's structured projection, frozen alongside its markdown
-- (epic #14 "Lore Release").
--
-- A plain additive ADD COLUMN: nullable with NO `db.default`, so no rebuild.
-- JSON, stored as text like every other array column here.
--
-- It exists so BOTH projections of a published release's changelog freeze
-- together. The milestone recorder froze the markdown and recomputed the rows
-- on every read, so a quest edited after the close showed a different title in
-- the page than in the downloadable `.md`.

ALTER TABLE `releases` ADD `changelog_groups` text;
