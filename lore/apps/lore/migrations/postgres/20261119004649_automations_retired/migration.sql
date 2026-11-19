-- Automations are deleted from the code (#E159, #Q3896). Data only, no table
-- change: the five tables stay until #Q3902 drops them.
UPDATE "organization_ranks"
SET "permissions" = array_remove(array_remove(array_remove(array_remove("permissions",
  'automation:read'), 'automation:write'), 'automation:manage'), 'automation:*')
WHERE "permissions" && ARRAY['automation:read', 'automation:write', 'automation:manage', 'automation:*']::text[];--> statement-breakpoint
UPDATE "api_keys"
SET "permissions" = array_remove(array_remove(array_remove(array_remove("permissions",
  'automation:read'), 'automation:write'), 'automation:manage'), 'automation:*')
WHERE "permissions" && ARRAY['automation:read', 'automation:write', 'automation:manage', 'automation:*']::text[];--> statement-breakpoint
UPDATE "notification_preferences"
SET "muted_categories" = array_remove("muted_categories", 'automations')
WHERE 'automations' = ANY("muted_categories");
