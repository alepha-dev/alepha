-- #Q3704: the Remember capability's one option, `agentSummary`, is gone: the
-- summary is edited from Folio > Edit summary... in every project. Its stored
-- values are dropped; nothing else in `options` changes.
UPDATE `project_capabilities` SET `options` = json_remove(`options`, '$.agentSummary')
WHERE `key` = 'remember' AND json_type(`options`, '$.agentSummary') IS NOT NULL;
