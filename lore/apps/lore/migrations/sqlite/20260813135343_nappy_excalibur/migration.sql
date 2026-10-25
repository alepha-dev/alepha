ALTER TABLE `projects` ADD `slug` text;--> statement-breakpoint
-- Backfill. Hand-written; everything below the ADD COLUMN was added to the
-- generated file on purpose. Read `docs/superpowers/specs/2026-08-13-lore-project-slug-routing-design.md`
-- before changing any of it — the ORDER of these statements is load-bearing.
--
-- Purely additive: ADD COLUMN + UPDATE + CREATE INDEX, no table rebuild, so
-- nothing here drops a table and none of the D1 cascade risk that wiped
-- production on 2026-05-13 applies. See apps/lore/CLAUDE.md "Migration safety
-- on D1". (Phrased without the literal statement name on purpose: the safety
-- check in that runbook is a grep, and a comment that matches it is a false
-- alarm for whoever runs it next.)
--
-- SQLite has no regex replace, so this is a coarser transform than
-- `ProjectSlugService.slugify`: it handles the ASCII case and lets everything
-- else fall through to the `project-<id>` fallback below. An accented title
-- therefore lands on the fallback rather than transliterating — renaming such
-- a project once, post-deploy, claims the pretty slug. Correct-and-ugly beats
-- a clever SQL transliteration that cannot be tested against real data first.
UPDATE projects
   SET slug = lower(replace(replace(trim(title), ' ', '-'), '_', '-'))
 WHERE deleted_at IS NULL;--> statement-breakpoint
-- Collapse separator runs ("Elf - Summer" -> "elf---summer") and trim the ends.
UPDATE projects
   SET slug = trim(
         replace(replace(replace(slug, '----', '-'), '---', '-'), '--', '-'),
         '-'
       )
 WHERE slug IS NOT NULL;--> statement-breakpoint
-- Anything the coarse transform could not express (accents, CJK, empty) falls
-- back to the id namespace, which `ProjectSlugService.isReserved` keeps users
-- from claiming.
UPDATE projects
   SET slug = 'project-' || id
 WHERE slug IS NULL OR slug = '' OR slug GLOB '*[^a-z0-9-]*';--> statement-breakpoint
-- Deduplicate BEFORE the unique index exists — a collision here would abort
-- the whole migration. Lowest id keeps the clean slug; every other row
-- carrying it gets its id appended. A row already on 'project-<id>' becomes
-- 'project-<id>-<id>' — harmless, and still unique.
UPDATE projects
   SET slug = slug || '-' || id
 WHERE slug IS NOT NULL
   AND id NOT IN (
         SELECT MIN(id) FROM projects WHERE slug IS NOT NULL GROUP BY slug
       );--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_idx` ON `projects` (`slug`);
