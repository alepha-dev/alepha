import { $inject } from "alepha";
import type { UserAccountToken } from "alepha/security";
import { ConflictError } from "alepha/server";

import {
  automationPageQuerySchema,
  type AutomationPageQuery,
} from "../schemas/automationPageQuerySchema.ts";
import { automationVariableResourceSchema } from "../schemas/automationVariableResourceSchema.ts";
import {
  automationVariableSetBodySchema,
  type AutomationVariableSetBody,
} from "../schemas/automationVariableSetBodySchema.ts";
import { AutomationAccess } from "./AutomationAccess.ts";
import { AutomationCatalog } from "./AutomationCatalog.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { AutomationVariables } from "./AutomationVariables.ts";

export class AutomationVariableService {
  protected readonly access = $inject(AutomationAccess);
  protected readonly database = $inject(AutomationDatabase);
  protected readonly catalog = $inject(AutomationCatalog);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly variables = $inject(AutomationVariables);
  public async list(
    projectId: number,
    user: UserAccountToken,
    input: Partial<AutomationPageQuery> = {},
  ) {
    return this.database.primary(async () => {
      await this.access.assert(projectId, user, "automation:read");
      const query = automationPageQuerySchema.parse(input);
      const rows = await this.persistence.variables.findMany({
        where: { projectId },
        orderBy: "key",
        offset: query.offset,
        limit: query.limit + 1,
      });
      const items = [];
      for (const row of rows.slice(0, query.limit)) {
        const inspected = await this.catalog.inspectVariable(
          projectId,
          user,
          row,
        );
        items.push(
          automationVariableResourceSchema.parse({
            id: row.id,
            key: row.key,
            version: row.version,
            kind: row.value.kind,
            value: inspected.available ? row.value : null,
            available: inspected.available,
            ...("reason" in inspected ? { reason: inspected.reason } : {}),
          }),
        );
      }
      return {
        items,
        hasMore: rows.length > query.limit,
        ...(rows.length > query.limit
          ? { nextOffset: query.offset + query.limit }
          : {}),
      };
    });
  }
  public async set(
    projectId: number,
    user: UserAccountToken,
    key: string,
    input: AutomationVariableSetBody,
  ) {
    return this.database.primary(async () => {
      await this.access.assert(projectId, user, "automation:manage");
      const body = automationVariableSetBodySchema.parse(input);
      const current = await this.persistence.variables.findOne({
        where: { projectId, key },
      });
      if (
        current &&
        (body.id !== current.id || body.version !== current.version)
      )
        throw new ConflictError(
          "Variable identity or version changed; reload before editing",
        );
      const result = await this.variables.set(projectId, user, {
        key,
        ...body,
      });
      return {
        variable: automationVariableResourceSchema.parse({
          id: result.variable.id,
          key,
          version: result.variable.version,
          kind: result.variable.value.kind,
          value: result.variable.value,
          available: true,
        }),
        affected: result.affected.slice(0, 50),
        affectedCount: result.affected.length,
        affectedHasMore: result.affected.length > 50,
      };
    });
  }
  public remove(
    projectId: number,
    user: UserAccountToken,
    key: string,
    id: string,
    version: number,
  ) {
    return this.variables.remove(projectId, user, key, version, id);
  }
  public async dependents(
    projectId: number,
    user: UserAccountToken,
    key: string,
    input: Partial<AutomationPageQuery> = {},
  ) {
    const query = automationPageQuerySchema.parse(input);
    const rows = await this.variables.dependents(projectId, user, key);
    return {
      items: rows.slice(query.offset, query.offset + query.limit),
      hasMore: rows.length > query.offset + query.limit,
    };
  }
}
