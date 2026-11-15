-- #Q3704: see the sqlite migration of the same name.
UPDATE "project_capabilities" SET "options" = "options" - 'agentSummary'
WHERE "key" = 'remember' AND "options" ? 'agentSummary';
