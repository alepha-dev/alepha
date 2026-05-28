-- Quest #90 — seed the Lore-self sigil so Lore's production browser bundle
-- reports its own uncaught exceptions into campaign #2's Blights inbox via
-- the exact code path a third-party site would use.
--
-- CONDITIONAL by design: campaign #2 ("Lore") only exists in PRODUCTION.
-- Dev/fresh/in-memory test DBs have no campaign #2 — a plain INSERT would
-- violate the `sigils.campaign_id` foreign key and abort the migration,
-- breaking app boot. The `WHERE EXISTS (...)` guard inserts NOTHING when
-- campaign #2 is absent. `INSERT OR IGNORE` additionally makes it
-- idempotent — a re-run hits the `id` PK conflict and is a no-op.
--
-- The fixed `id` here MUST match `VITE_LORE_SELF_SIGIL` in alepha.config.ts.
-- `ingest_key` is a fixed random secret (the column is NOT NULL).
-- `created_by` is NULL — the column is nullable precisely for this seed.
INSERT OR IGNORE INTO sigils (id, ingest_key, campaign_id, label, allowed_origins, kinds, created_by, created_at)
SELECT
  '4474024c-d0bf-46d9-b8b0-a562a5d41a60',
  '6e028db3db28cdc57e4ce0129b9ce8365b6965c4bcec1b2c',
  2,
  'lore.alepha.dev (self)',
  '["https://lore.alepha.dev"]',
  '["blights"]',
  NULL,
  1779278231642
WHERE EXISTS (SELECT 1 FROM campaigns WHERE id = 2);
