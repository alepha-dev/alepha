-- A server error group is trusted on arrival (#Q4255). Data only, no table
-- change: the groups a server reported before this deploy started untrusted
-- (#Q4233), and are trusted here as they would have been, at their first
-- sighting and by no member. An uptime outage (`uptime:` fingerprint) is
-- left alone: its text comes from the monitored URL.
UPDATE `project_errors`
SET `trusted_at` = `first_seen_at`
WHERE `origin` = 'server'
  AND `trusted_at` IS NULL
  AND `fingerprint` NOT LIKE 'uptime:%';
