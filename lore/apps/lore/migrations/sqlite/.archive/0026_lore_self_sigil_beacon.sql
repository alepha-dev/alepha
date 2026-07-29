-- Quest #91 — extend the Lore-self bootstrap sigil's `kinds` to also grant
-- the `"beacon"` capability, so Lore's own production pageviews land in
-- campaign #2's Insights dashboard via the exact ingestion path a
-- third-party site uses.
--
-- The self-sigil was seeded by quest #90's migration 0024 with
-- `kinds = ["blights"]`. That migration already shipped to PRODUCTION, so
-- it cannot be edited — this is a NEW, additive data migration.
--
-- CONDITIONAL by nature: the self-sigil row only exists in PRODUCTION
-- (campaign #2 is production-only — see 0024). On a dev / fresh / in-memory
-- test DB the row is absent, and a plain `UPDATE ... WHERE id = '...'` that
-- matches nothing is a silent 0-row no-op — no guard needed.
--
-- D1-safe: a single-row `UPDATE`, no table rebuild, no `DROP TABLE`, so the
-- D1 CASCADE-on-DROP bomb (CLAUDE.md) does not apply.
UPDATE sigils
SET kinds = '["blights","beacon"]'
WHERE id = '4474024c-d0bf-46d9-b8b0-a562a5d41a60';
