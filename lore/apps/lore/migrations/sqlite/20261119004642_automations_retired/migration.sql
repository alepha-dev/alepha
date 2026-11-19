-- Automations are deleted from the code (#E159, #Q3896). Data only, no table
-- change: the five tables stay until #Q3902 drops them.
--
-- `automation:read`, `automation:write`, `automation:manage` and
-- `automation:*` leave every stored rank and API key (JSON text arrays).
UPDATE `organization_ranks`
SET `permissions` = (
  SELECT json_group_array(value) FROM json_each(`organization_ranks`.`permissions`)
  WHERE value NOT IN ('automation:read', 'automation:write', 'automation:manage', 'automation:*')
)
WHERE EXISTS (
  SELECT 1 FROM json_each(`organization_ranks`.`permissions`)
  WHERE value IN ('automation:read', 'automation:write', 'automation:manage', 'automation:*')
);--> statement-breakpoint
UPDATE `api_keys`
SET `permissions` = (
  SELECT json_group_array(value) FROM json_each(`api_keys`.`permissions`)
  WHERE value NOT IN ('automation:read', 'automation:write', 'automation:manage', 'automation:*')
)
WHERE EXISTS (
  SELECT 1 FROM json_each(`api_keys`.`permissions`)
  WHERE value IN ('automation:read', 'automation:write', 'automation:manage', 'automation:*')
);--> statement-breakpoint
-- The `automations` notification category a member may have muted.
UPDATE `notification_preferences`
SET `muted_categories` = (
  SELECT json_group_array(value) FROM json_each(`notification_preferences`.`muted_categories`)
  WHERE value <> 'automations'
)
WHERE EXISTS (
  SELECT 1 FROM json_each(`notification_preferences`.`muted_categories`)
  WHERE value = 'automations'
);
