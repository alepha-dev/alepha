import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { DbCacheProvider, sql, type SQLLike } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, ConflictError, ForbiddenError } from "alepha/server";

import { automations } from "../entities/automations.ts";
import type { Automation } from "../entities/automations.ts";
import {
  automationVariables,
  type AutomationVariable,
} from "../entities/automationVariables.ts";
import { AutomationCron } from "../schemas/AutomationCron.ts";
import type { AutomationRule } from "../schemas/automationRuleSchema.ts";
import {
  automationVariableValueSchema,
  type AutomationVariableValue,
} from "../schemas/automationVariableValueSchema.ts";
import { AutomationAccess } from "./AutomationAccess.ts";
import { AutomationApprovalFence } from "./AutomationApprovalFence.ts";
import { AutomationBatchRepository } from "./AutomationBatchRepository.ts";
import { AutomationCatalog } from "./AutomationCatalog.ts";
import { AutomationConfigurationWrites } from "./AutomationConfigurationWrites.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import {
  AutomationDependencies,
  AutomationDependencyError,
} from "./AutomationDependencies.ts";
import { AutomationMutationAudit } from "./AutomationMutationAudit.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { AutomationRunEvidence } from "./AutomationRunEvidence.ts";

/**
 * Shared values are executable configuration. Consumers owned by another member
 * must approve a changed version before it can redirect their stored program.
 */
export class AutomationVariables {
  protected readonly database = $inject(AutomationDatabase);
  protected readonly writes = $inject(AutomationConfigurationWrites);
  protected readonly approvals = $inject(AutomationApprovalFence);
  protected readonly ruleRows = $inject(
    AutomationBatchRepository.of(automations),
  );
  protected readonly variableRows = $inject(
    AutomationBatchRepository.of(automationVariables),
  );
  protected readonly audit = $inject(AutomationMutationAudit);
  protected readonly cache = $inject(DbCacheProvider);
  protected readonly dependencies = $inject(AutomationDependencies);
  protected readonly evidence = $inject(AutomationRunEvidence);
  protected readonly access = $inject(AutomationAccess);
  protected readonly cron = $inject(AutomationCron);
  protected readonly time = $inject(DateTimeProvider);
  protected readonly catalog = $inject(AutomationCatalog);
  protected readonly persistence = $inject(AutomationPersistence);

  public async set(
    projectId: number,
    user: UserAccountToken,
    input: {
      key: string;
      value: AutomationVariableValue;
      version?: number;
      id?: string;
    },
  ) {
    return this.database.primary(async () => {
      await this.access.assert(projectId, user, "automation:manage");
      const key = automationVariables.schema.shape.key.parse(input.key);
      if (this.catalog.reservedNames().has(key))
        throw new BadRequestError(
          `Variable '${key}' uses a reserved context name`,
        );
      const parsed = automationVariableValueSchema.safeParse(input.value);
      if (!parsed.success) throw new BadRequestError(parsed.error.message);
      const current = await this.persistence.variables.findOne({
        where: { projectId, key },
      });
      if (
        current &&
        (input.version !== current.version ||
          (input.id !== undefined && input.id !== current.id))
      )
        throw new ConflictError(
          "Variable identity or version changed; reload before editing",
        );
      if (!current && (input.version !== undefined || input.id !== undefined))
        throw new ConflictError("Variable no longer exists");
      const candidate = {
        ...current,
        id: current?.id ?? crypto.randomUUID(),
        projectId,
        key,
        value: parsed.data,
        version: (current?.version ?? -1) + 1,
      } as AutomationVariable;
      const inspected = await this.catalog.inspectVariable(
        projectId,
        user,
        candidate,
      );
      if (!inspected.available)
        throw new BadRequestError(
          "reason" in inspected ? inspected.reason : "Variable is unavailable",
        );
      const plans: Array<{
        rule: Automation;
        scheduleCron?: string;
        approved: Automation["approvedVariables"];
        foreign: boolean;
      }> = [];
      const dependencies = new Map<
        string,
        Automation["approvedVariables"][number]
      >();
      if (current) {
        for await (const rule of this.consumers(projectId, key)) {
          const foreign = rule.authorUserId !== user.id;
          let scheduleCron: string | undefined;
          let approved = rule.approvedVariables;
          if (!foreign) {
            const names = [...this.references(rule.rule)];
            const values = await this.persistence.variables.findMany({
              where: { projectId, key: { inArray: names } },
              limit: 64,
            });
            for (const value of values) {
              if (value.id === current.id) continue;
              if (
                dependencies.has(value.id) &&
                dependencies.get(value.id)!.version !== value.version
              )
                throw new ConflictError(
                  "Shared configuration changed during validation",
                );
              dependencies.set(value.id, {
                id: value.id,
                key: value.key,
                version: value.version,
              });
            }
            const overrides = new Map(
              values.map((value) => [
                value.key,
                value.id === current.id ? candidate : value,
              ]),
            );
            const compiled = await this.catalog.compile(
              projectId,
              await this.access.author(rule),
              rule.rule,
              overrides,
            );
            scheduleCron = compiled.scheduleCron;
            approved = this.approvals.capture([...overrides.values()]);
          }
          plans.push({ rule, scheduleCron, approved, foreign });
        }
        // Foreign programs pause before a changed value can become visible.
        // A later CAS failure intentionally leaves that safe review state.
        for (const plan of plans) {
          if (plan.foreign)
            await this.evidence.transition(
              plan.rule.id,
              "paused",
              `Shared variable '${key}' changed; author review is required`,
              true,
              { expectedVersion: plan.rule.version },
            );
          const latest = await this.persistence.rules.getById(plan.rule.id);
          if (
            latest.revision !== plan.rule.revision ||
            (plan.foreign && !latest.requiresApproval)
          )
            throw new ConflictError(
              "Automation changed while validating shared variables",
            );
          plan.rule = latest;
        }
      }
      const now = this.time.nowISOString();
      const statements: SQLLike[] = [];
      for (const plan of plans) {
        const rule = plan.rule;
        statements.push(
          this.ruleRows.updateStatement(
            { id: rule.id, version: rule.version, revision: rule.revision },
            {
              revision: rule.revision + 1,
              activatedAt: now,
              ...(!plan.foreign
                ? {
                    approvedVariables: plan.approved,
                    scheduleCron: plan.scheduleCron ?? null,
                    nextRunAt:
                      rule.enabled && plan.scheduleCron
                        ? this.cron.next(plan.scheduleCron, now)
                        : null,
                  }
                : {}),
              ...(this.predicateUses(rule.rule, key) ? { baseline: null } : {}),
              updatedAt: now,
            },
            false,
          ),
        );
      }
      statements.push(
        current
          ? this.variableRows.updateStatement(
              { id: current.id, version: current.version },
              { value: parsed.data, updatedAt: now },
              false,
            )
          : this.variableRows.insertStatement({
              id: candidate.id,
              projectId,
              key,
              value: parsed.data,
            }),
      );
      statements.push(
        this.audit.statement(projectId, user, "variable_set", candidate.id, {
          key,
          version: candidate.version,
          affected: plans.length,
        }),
      );
      const condition = current
        ? sql`${this.variableRows.exists({ id: current.id, version: current.version })} AND ${this.approvals.consumers(
            current.id,
            projectId,
            plans.map(({ rule }) => ({
              id: rule.id,
              version: rule.version,
              revision: rule.revision,
            })),
          )} AND ${this.approvals.current(projectId, [...dependencies.values()])}`
        : this.variableRows.notExists({ projectId, key });
      try {
        await this.writes.commit(projectId, condition, statements);
      } catch (error) {
        if (
          (
            await this.persistence.variables.findOne({
              where: { projectId, key },
            })
          )?.version !== current?.version
        )
          throw new ConflictError(
            "Variable identity or version changed; reload before editing",
          );
        throw error;
      }
      for (const table of ["automations", "automation_variables", "audits"])
        await this.cache.invalidateTable(table);
      await this.audit.activity(projectId, user, "variable_set");
      return {
        variable: await this.persistence.variables.getById(candidate.id),
        affected: plans.map(({ rule, foreign }) => ({
          id: rule.id,
          title: rule.title,
          authorUserId: rule.authorUserId,
          requiresApproval: foreign || rule.requiresApproval,
        })),
      };
    });
  }

  public async remove(
    projectId: number,
    user: UserAccountToken,
    key: string,
    version: number,
    id?: string,
  ): Promise<void> {
    return this.database.primary(async () => {
      await this.access.assert(projectId, user, "automation:manage");
      const row = await this.persistence.variables.getOne({
        where: { projectId, key },
      });
      if (version !== row.version || (id !== undefined && id !== row.id))
        throw new ConflictError(
          "Variable identity or version changed; reload before deleting",
        );
      for await (const rule of this.consumers(projectId, key))
        throw new ConflictError(
          `Variable '${key}' is referenced by automation '${rule.title}'`,
        );
      await this.writes.commit(
        projectId,
        sql`${this.variableRows.exists({ id: row.id, version })} AND ${this.approvals.consumers(row.id, projectId, [])}`,
        [
          sql`DELETE FROM automation_variables WHERE id = ${row.id} AND version = ${version}`,
          this.audit.statement(projectId, user, "variable_delete", row.id, {
            key,
            version,
          }),
        ],
      );
      await this.cache.invalidateTable("automation_variables");
      await this.cache.invalidateTable("audits");
      await this.audit.activity(projectId, user, "variable_delete");
    });
  }

  /**
   * Read again for each run/effect. Resource status and source authority are
   * live inputs, even when the stored value and its version did not change.
   */
  public async snapshot(
    rule: Automation,
    user: UserAccountToken,
    options: { transition?: boolean } = {},
  ) {
    if (user.id !== rule.authorUserId)
      throw new ForbiddenError("Validate a run as its immutable author");
    try {
      await this.dependencies.assert(rule);
      const keys = [...this.references(rule.rule)];
      const rows = keys.length
        ? await this.persistence.variables.findMany({
            where: { projectId: rule.projectId, key: { inArray: keys } },
            limit: 64,
          })
        : [];
      await this.catalog.validate(
        rule.projectId,
        user,
        rule.rule,
        new Map(rows.map((row) => [row.key, row])),
      );
      return rows.map(({ id, key, version, value }) => ({
        id,
        key,
        version,
        value,
      }));
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : "Variable or rule validation failed";
      const latest = await this.persistence.rules.findById(rule.id);
      if (
        options.transition !== false &&
        latest &&
        latest.revision === rule.revision &&
        !latest.requiresApproval
      )
        await this.evidence.transition(
          rule.id,
          error instanceof AutomationDependencyError ? "broken" : "paused",
          reason.slice(0, 1024),
          !(error instanceof AutomationDependencyError),
          { expectedVersion: latest.version },
        );
      throw error;
    }
  }

  public assertApproved(
    rule: Automation,
    values: Array<{ id?: string; key: string; version: number }>,
  ): void {
    if (
      values.length !== rule.approvedVariables.length ||
      values.some(
        (value) =>
          !rule.approvedVariables.some(
            (approval) =>
              approval.id === value.id &&
              approval.key === value.key &&
              approval.version === value.version,
          ),
      )
    )
      throw new ForbiddenError(
        "Shared variable identities or versions changed; author review is required",
      );
  }

  public references(rule: AutomationRule): Set<string> {
    const reserved = this.catalog.reservedNames();
    return new Set(
      [...this.catalog.names(rule)].filter((key) => !reserved.has(key)),
    );
  }

  public async dependents(
    projectId: number,
    user: UserAccountToken,
    key: string,
  ) {
    await this.access.assert(projectId, user, "automation:manage");
    const result: Array<{ id: string; title: string; authorUserId: string }> =
      [];
    for await (const row of this.consumers(projectId, key))
      result.push({
        id: row.id,
        title: row.title,
        authorUserId: row.authorUserId,
      });
    return result;
  }

  protected async *consumers(
    projectId: number,
    key: string,
  ): AsyncGenerator<Automation> {
    let cursor: string | undefined;
    for (;;) {
      const page = await this.persistence.rules.findMany({
        where: { projectId, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: "id",
        limit: 100,
      });
      for (const row of page) if (this.references(row.rule).has(key)) yield row;
      if (page.length < 100) return;
      cursor = page[page.length - 1].id;
    }
  }
  protected predicateUses(rule: AutomationRule, key: string): boolean {
    if (!rule.guard) return false;
    return this.catalog
      .names({
        ...rule,
        trigger: { kind: "schedule", cron: "*/5 * * * *" },
        actions: [],
      })
      .has(key);
  }
}
