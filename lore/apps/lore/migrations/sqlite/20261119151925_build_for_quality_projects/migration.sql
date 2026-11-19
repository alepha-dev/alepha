-- Quality moves from Ship to Build, the fourth pillar (#E162, #Q3944): its
-- Reports tab, tiles, event and permissions now need `build`, which is off by
-- default. Every project that holds a quality run gets `build` turned on, so
-- nobody loses data or a tab. Data only, no table change; a project that
-- already has `build` is left as it is.
INSERT OR IGNORE INTO `project_capabilities` (`project_id`, `key`, `options`)
SELECT DISTINCT `project_id`, 'build', '{}' FROM `quality_runs`;
