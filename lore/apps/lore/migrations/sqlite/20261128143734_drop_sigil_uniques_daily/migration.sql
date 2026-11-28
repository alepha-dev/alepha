DROP INDEX IF EXISTS `sigil_uniques_daily_sigil_id_day_visitor_hash_traffic_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `sigil_uniques_daily_sigil_id_day_idx`;--> statement-breakpoint
-- alepha-allow-drop-table: a leaf child of sigils that nothing reads or references any more; visitors are counted from sessions and the page view log (#Q4397)
DROP TABLE `sigil_uniques_daily`;