-- #Q3613: a stored rule's notify names `channels`, a list, instead of one
-- `channel`. Rewrites every stored rule's notify actions in place, order
-- kept; run snapshots keep `channel`, the form a run executes.
UPDATE `automations`
SET `rule` = json_set(`rule`, '$.actions', json((
  SELECT json_group_array(
    CASE
      WHEN json_extract(`a`.`value`, '$.kind') = 'notify'
        AND json_type(`a`.`value`, '$.channel') IS NOT NULL
      THEN json_set(
        json_remove(`a`.`value`, '$.channel'),
        '$.channels',
        json_array(json_extract(`a`.`value`, '$.channel'))
      )
      ELSE json(`a`.`value`)
    END
  )
  FROM json_each(`automations`.`rule`, '$.actions') AS `a`
)))
WHERE EXISTS (
  SELECT 1 FROM json_each(`automations`.`rule`, '$.actions') AS `a`
  WHERE json_extract(`a`.`value`, '$.kind') = 'notify'
    AND json_type(`a`.`value`, '$.channel') IS NOT NULL
);
