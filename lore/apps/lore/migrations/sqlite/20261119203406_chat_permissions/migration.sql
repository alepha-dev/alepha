-- Chat (#E161, #Q3924): the `chat:*` permissions reach the ranks and API
-- keys that are stored rows. Default Members get them from code; stored Admin,
-- Viewer and customised Member ranks, and API keys, are never reseeded, so
-- without this only the owner would reach chat in an existing project.
--
-- `chat:read` wherever `project:read` is (the floor: Viewer reads open
-- rooms), `chat:write` wherever the rank writes quests or folios, `chat:manage`
-- wherever `member:manage` is (the Admin), and `chat:*` for `project:*`.
UPDATE `organization_ranks` SET `permissions` = json_insert(`permissions`, '$[#]', 'chat:read')
WHERE (EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'project:read'))
  AND NOT EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'chat:read');--> statement-breakpoint
UPDATE `organization_ranks` SET `permissions` = json_insert(`permissions`, '$[#]', 'chat:write')
WHERE (EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'quest:create') OR EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'folio:write'))
  AND NOT EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'chat:write');--> statement-breakpoint
UPDATE `organization_ranks` SET `permissions` = json_insert(`permissions`, '$[#]', 'chat:manage')
WHERE (EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'member:manage'))
  AND NOT EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'chat:manage');--> statement-breakpoint
UPDATE `organization_ranks` SET `permissions` = json_insert(`permissions`, '$[#]', 'chat:*')
WHERE (EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'project:*'))
  AND NOT EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'chat:*');--> statement-breakpoint
UPDATE `api_keys` SET `permissions` = json_insert(`permissions`, '$[#]', 'chat:read')
WHERE (EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'project:read'))
  AND NOT EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'chat:read');--> statement-breakpoint
UPDATE `api_keys` SET `permissions` = json_insert(`permissions`, '$[#]', 'chat:write')
WHERE (EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'quest:create') OR EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'folio:write'))
  AND NOT EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'chat:write');--> statement-breakpoint
UPDATE `api_keys` SET `permissions` = json_insert(`permissions`, '$[#]', 'chat:manage')
WHERE (EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'member:manage'))
  AND NOT EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'chat:manage');--> statement-breakpoint
UPDATE `api_keys` SET `permissions` = json_insert(`permissions`, '$[#]', 'chat:*')
WHERE (EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'project:*'))
  AND NOT EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'chat:*');
