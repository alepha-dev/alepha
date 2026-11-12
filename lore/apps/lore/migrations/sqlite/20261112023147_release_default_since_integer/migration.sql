-- Releases: `default_since` back to INTEGER milliseconds (#Q3453).
--
-- Data only, guarded, safe to apply twice. The default-release swap bound
-- an ISO string into a CASE, so SQLite stored TEXT in this INTEGER column
-- for every release made the default through a swap. The text reads back
-- as the same date, so nothing showed it; it would sort ahead of every
-- integer row. Each text value becomes its epoch milliseconds, exactly:
-- whole seconds from `%s`, the millisecond part from `%f`. A value SQLite
-- cannot parse would give NULL there, and is left as it is.

UPDATE `releases`
SET `default_since` =
  CAST(strftime('%s', `default_since`) AS INTEGER) * 1000
  + CAST(substr(strftime('%f', `default_since`), 4) AS INTEGER)
WHERE typeof(`default_since`) = 'text'
  AND strftime('%s', `default_since`) IS NOT NULL;
