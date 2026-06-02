-- Data-only migration: extend the Lore-self sigil to the full sigil capability
-- set (blights + beacon + vitals + petition) and enable the matching feature
-- flags on campaign #2 so the dogfood path works end-to-end.
--
-- CONDITIONAL by nature (like 0026):
--   The self-sigil row only exists in production (campaign #2 is
--   production-only — see 0024). On a dev / fresh / in-memory test DB the
--   WHERE clause matches nothing and the UPDATE is a silent 0-row no-op.
--
-- D1-safe: pure UPDATE statements, no table rebuild, no DROP TABLE. The D1
-- CASCADE-on-DROP bomb (CLAUDE.md) does not apply.

-- Extend the self-sigil to the full capability set.
UPDATE sigils
SET kinds = '["blights","beacon","vitals","petition"]'
WHERE id = '4474024c-d0bf-46d9-b8b0-a562a5d41a60';
--> statement-breakpoint

-- Enable the sigil-related feature flags on campaign #2.
-- Uses json_set to set individual keys — preserves all existing feature keys.
-- NOTE: bare `true` in SQLite json_set stores the INTEGER 1, not a JSON
-- boolean; the features schema is t.boolean(), so we must wrap with
-- json('true') to store a real JSON `true`.
UPDATE campaigns
SET features = json_set(
  features,
  '$.sigils',            json('true'),
  '$.blights',           json('true'),
  '$.beacon',            json('true'),
  '$.vitals',            json('true'),
  '$.embeddedPetitions', json('true')
)
WHERE id = 2;
