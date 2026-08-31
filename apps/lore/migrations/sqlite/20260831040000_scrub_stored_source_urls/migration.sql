-- Data-only. No schema change, which is why this folder's snapshot is the
-- previous one re-chained: the DDL is identical and only the id moves.
--
-- Errors used to carry `location.href` verbatim into `blights.source_url` and
-- `sigil_error_groups.source_url`, so a throw on
-- `/auth/reset-password?token=abc123` stored the token. Both ends scrub now
-- (`sigilScrubUrl`, at the source and again at the sink), so every row written
-- since is clean - but the rows written before are not, and nothing reclaims
-- them: blights are readable by every project member, and a resolved or
-- `quest:`-forwarded blight is kept indefinitely as audit trail, outside the
-- retention sweep. Quest #239, objective 8.
--
-- Two passes per table rather than one expression: SQLite has no "split on
-- either character", and `?` and `#` can appear in either order.
--
-- ⚠️ No DROP TABLE anywhere here, so the D1 cascade quirk does not apply.
UPDATE `blights` SET `source_url` = substr(`source_url`, 1, instr(`source_url`, '?') - 1) WHERE instr(`source_url`, '?') > 0;--> statement-breakpoint
UPDATE `blights` SET `source_url` = substr(`source_url`, 1, instr(`source_url`, '#') - 1) WHERE instr(`source_url`, '#') > 0;--> statement-breakpoint
UPDATE `sigil_error_groups` SET `source_url` = substr(`source_url`, 1, instr(`source_url`, '?') - 1) WHERE instr(`source_url`, '?') > 0;--> statement-breakpoint
UPDATE `sigil_error_groups` SET `source_url` = substr(`source_url`, 1, instr(`source_url`, '#') - 1) WHERE instr(`source_url`, '#') > 0;
