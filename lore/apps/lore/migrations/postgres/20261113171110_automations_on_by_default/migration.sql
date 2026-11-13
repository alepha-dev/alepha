-- Automations is on by default (#Q3563). `CapabilityRegistry.optionsOf` reads
-- an option a row never stored as off, so turning `preselected` on reaches new
-- projects only: write it on every Work row that has no value for it. A row
-- that stored `false` (an owner turned it off) keeps it.
UPDATE "project_capabilities"
SET "options" = jsonb_set("options", '{automations}', 'true'::jsonb, true)
WHERE "key" = 'work' AND "options" -> 'automations' IS NULL;
