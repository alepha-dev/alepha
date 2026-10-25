import { $inject } from "alepha";
import { DatabaseProvider, sql, type SQLLike } from "alepha/orm";

import type { AutomationVariableApproval } from "../schemas/automationVariableApprovalSchema.ts";

/**
 * Native predicates bind approval to the same variable identities/versions as
 * the authored program, including the create/enable versus variable-edit race.
 */
export class AutomationApprovalFence {
  protected readonly database = $inject(DatabaseProvider);
  public capture(
    values: Array<{ id?: string; key: string; version: number }>,
  ): AutomationVariableApproval[] {
    return values
      .map((value) => ({
        id: value.id!,
        key: value.key,
        version: value.version,
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }
  public current(
    projectId: number,
    values: AutomationVariableApproval[],
  ): SQLLike {
    if (!values.length) return sql`TRUE`;
    return sql.join(
      values.map(
        (value) =>
          sql`EXISTS (SELECT 1 FROM automation_variables WHERE id = ${value.id} AND project_id = ${projectId} AND key = ${value.key} AND version = ${value.version})`,
      ),
      sql` AND `,
    );
  }
  public consumers(
    variableId: string,
    projectId: number,
    rules: Array<{ id: string; version: number; revision: number }>,
  ): SQLLike {
    const expected = JSON.stringify(rules);
    if (this.database.dialect === "sqlite")
      return sql`NOT EXISTS (SELECT 1 FROM json_each(${expected}) AS expected LEFT JOIN automations AS consumer ON consumer.id = json_extract(expected.value, '$.id') AND consumer.version = json_extract(expected.value, '$.version') AND consumer.revision = json_extract(expected.value, '$.revision') AND consumer.deleted_at IS NULL WHERE consumer.id IS NULL) AND NOT EXISTS (SELECT 1 FROM automations AS consumer, json_each(consumer.approved_variables) AS approval WHERE consumer.project_id = ${projectId} AND consumer.deleted_at IS NULL AND json_extract(approval.value, '$.id') = ${variableId} AND NOT EXISTS (SELECT 1 FROM json_each(${expected}) AS expected WHERE json_extract(expected.value, '$.id') = consumer.id))`;
    return sql`NOT EXISTS (SELECT 1 FROM jsonb_array_elements(${expected}::jsonb) AS expected LEFT JOIN automations AS consumer ON consumer.id::text = expected->>'id' AND consumer.version = (expected->>'version')::integer AND consumer.revision = (expected->>'revision')::integer AND consumer.deleted_at IS NULL WHERE consumer.id IS NULL) AND NOT EXISTS (SELECT 1 FROM automations AS consumer, jsonb_array_elements(consumer.approved_variables::jsonb) AS approval WHERE consumer.project_id = ${projectId} AND consumer.deleted_at IS NULL AND approval->>'id' = ${variableId} AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(${expected}::jsonb) AS expected WHERE expected->>'id' = consumer.id::text))`;
  }
  public stored(): SQLLike {
    return this.database.dialect === "sqlite"
      ? sql`NOT EXISTS (SELECT 1 FROM json_each(rule.approved_variables) AS approval LEFT JOIN automation_variables AS variable ON variable.id = json_extract(approval.value, '$.id') AND variable.project_id = rule.project_id AND variable.key = json_extract(approval.value, '$.key') AND variable.version = json_extract(approval.value, '$.version') WHERE variable.id IS NULL)`
      : sql`NOT EXISTS (SELECT 1 FROM jsonb_array_elements(rule.approved_variables::jsonb) AS approval LEFT JOIN automation_variables AS variable ON variable.id::text = approval->>'id' AND variable.project_id = rule.project_id AND variable.key = approval->>'key' AND variable.version = (approval->>'version')::integer WHERE variable.id IS NULL)`;
  }
}
