-- Prompts becomes a capability, `prompts`, off by default (#E175, #Q4313).
-- A capability is on only while its row exists, so a project that already
-- uses Prompts is given the row and no schedule stops: one with a row in
-- `prompts` (a custom prompt, or a built-in configured), an agent job, or a
-- host of its own that is an Agent host. Every other project starts without
-- it. Data only, no table change; a project that already has it keeps it.
INSERT OR IGNORE INTO `project_capabilities` (`project_id`, `key`, `options`)
SELECT `id`, 'prompts', '{}' FROM `projects`
WHERE `id` IN (SELECT `project_id` FROM `prompts`)
   OR `id` IN (SELECT `project_id` FROM `host_jobs` WHERE `kind` = 'agent')
   OR `id` IN (SELECT `project_id` FROM `hosts` WHERE `agent_host` = 1);
