-- Chat (#E161, #Q3924): the `chat:*` permissions reach the ranks and API
-- keys that are stored rows. Default Members get them from code; stored Admin,
-- Viewer and customised Member ranks, and API keys, are never reseeded, so
-- without this only the owner would reach chat in an existing project.
--
-- `chat:read` wherever `project:read` is (the floor: Viewer reads open
-- rooms), `chat:write` wherever the rank writes quests or folios, `chat:manage`
-- wherever `member:manage` is (the Admin), and `chat:*` for `project:*`.
UPDATE "organization_ranks" SET "permissions" = array_append("permissions", 'chat:read')
WHERE ('project:read' = ANY("permissions")) AND NOT 'chat:read' = ANY("permissions");--> statement-breakpoint
UPDATE "organization_ranks" SET "permissions" = array_append("permissions", 'chat:write')
WHERE ('quest:create' = ANY("permissions") OR 'folio:write' = ANY("permissions")) AND NOT 'chat:write' = ANY("permissions");--> statement-breakpoint
UPDATE "organization_ranks" SET "permissions" = array_append("permissions", 'chat:manage')
WHERE ('member:manage' = ANY("permissions")) AND NOT 'chat:manage' = ANY("permissions");--> statement-breakpoint
UPDATE "organization_ranks" SET "permissions" = array_append("permissions", 'chat:*')
WHERE ('project:*' = ANY("permissions")) AND NOT 'chat:*' = ANY("permissions");--> statement-breakpoint
UPDATE "api_keys" SET "permissions" = array_append("permissions", 'chat:read')
WHERE ('project:read' = ANY("permissions")) AND NOT 'chat:read' = ANY("permissions");--> statement-breakpoint
UPDATE "api_keys" SET "permissions" = array_append("permissions", 'chat:write')
WHERE ('quest:create' = ANY("permissions") OR 'folio:write' = ANY("permissions")) AND NOT 'chat:write' = ANY("permissions");--> statement-breakpoint
UPDATE "api_keys" SET "permissions" = array_append("permissions", 'chat:manage')
WHERE ('member:manage' = ANY("permissions")) AND NOT 'chat:manage' = ANY("permissions");--> statement-breakpoint
UPDATE "api_keys" SET "permissions" = array_append("permissions", 'chat:*')
WHERE ('project:*' = ANY("permissions")) AND NOT 'chat:*' = ANY("permissions");
