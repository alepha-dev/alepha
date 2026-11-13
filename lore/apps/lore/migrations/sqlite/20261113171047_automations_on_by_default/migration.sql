-- Automations is on by default (#Q3563). `CapabilityRegistry.optionsOf` reads
-- an option a row never stored as off, so turning `preselected` on reaches new
-- projects only: write it on every Work row that has no value for it. A row
-- that stored `false` (an owner turned it off) keeps it. `json('true')` is a
-- JSON boolean, which the option schema needs; a bare 1 would fail to decode.
UPDATE `project_capabilities`
SET `options` = json_set(`options`, '$.automations', json('true'))
WHERE `key` = 'work' AND json_type(`options`, '$.automations') IS NULL;
