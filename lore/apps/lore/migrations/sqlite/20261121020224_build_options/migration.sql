-- Build gets two options, `repositories` and `quality` (#Q4005). An option
-- reads off when its key is absent, so every project that had Build before
-- the split is given both on: nobody loses a repository or the Quality tab.
-- Data only, no table change; `json('true')` writes a JSON boolean, never 1.
UPDATE `project_capabilities`
SET `options` = json_set(`options`, '$.repositories', json('true'), '$.quality', json('true'))
WHERE `key` = 'build';
