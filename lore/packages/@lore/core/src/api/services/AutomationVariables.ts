import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, ConflictError, ForbiddenError } from "alepha/server";

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
import { AutomationCatalog } from "./AutomationCatalog.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { AutomationRunEvidence } from "./AutomationRunEvidence.ts";

/**
 * Shared values are executable configuration. Consumers owned by another member
 * must approve a changed version before it can redirect their stored program.
 */
export class AutomationVariables {
  protected readonly evidence = $inject(AutomationRunEvidence);
  protected readonly access = $inject(AutomationAccess);
  protected readonly cron = $inject(AutomationCron);
  protected readonly time = $inject(DateTimeProvider);
  protected readonly catalog = $inject(AutomationCatalog);
  protected readonly persistence = $inject(AutomationPersistence);

  public async set(
    projectId: number,
    user: UserAccountToken,
    input: { key: string; value: AutomationVariableValue; version?: number },
  ) {
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
    if (current && input.version !== current.version)
      throw new ConflictError(
        "Variable version changed; reload before editing",
      );
    if (!current && input.version !== undefined)
      throw new ConflictError("Variable no longer exists");
    // Only value/key matter to inspection. Never invent a resource or author ID.
    const candidate = {
      ...current,
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
    const affected: Array<{
      id: string;
      title: string;
      authorUserId: string;
      requiresApproval: boolean;
    }> = [];
    if (current) {
      // Validate all same-author consumers before any mutation. Foreign programs
      // are paused first, so a failure cannot leave a redirected live program.
      const schedules = new Map<string, string | undefined>();
      for await (const rule of this.consumers(projectId, key)) {
        if (rule.authorUserId === user.id) {
          const compiled = await this.catalog.compile(
            projectId,
            await this.access.author(rule),
            rule.rule,
            new Map([[key, candidate]]),
          );
          schedules.set(rule.id, compiled.scheduleCron);
        }
      }
      for await (const rule of this.consumers(projectId, key)) {
        const requiresApproval = rule.authorUserId !== user.id;
        await this.persistence.rules.updateById(rule.id, {
          version: rule.version,
          revision: rule.revision + 1,
          baseline: null,
          ...(!requiresApproval &&
          schedules.get(rule.id) &&
          schedules.get(rule.id) !== rule.scheduleCron
            ? {
                scheduleCron: schedules.get(rule.id),
                nextRunAt: this.cron.next(
                  schedules.get(rule.id)!,
                  this.time.nowISOString(),
                ),
              }
            : {}),
          ...(requiresApproval
            ? {
                health: "paused",
                requiresApproval: true,
                reason: `Shared variable '${key}' changed; author review is required`,
              }
            : {}),
        });
        affected.push({
          id: rule.id,
          title: rule.title,
          authorUserId: rule.authorUserId,
          requiresApproval,
        });
      }
    }
    const variable = current
      ? await this.persistence.variables.updateById(current.id, {
          value: parsed.data,
          version: current.version,
        })
      : await this.persistence.variables.create({
          projectId,
          key,
          value: parsed.data,
        });
    return { variable, affected };
  }

  public async remove(
    projectId: number,
    user: UserAccountToken,
    key: string,
    version: number,
  ): Promise<void> {
    await this.access.assert(projectId, user, "automation:manage");
    const row = await this.persistence.variables.getOne({
      where: { projectId, key },
    });
    if (version !== row.version)
      throw new ConflictError(
        "Variable version changed; reload before deleting",
      );
    for await (const rule of this.consumers(projectId, key))
      throw new ConflictError(
        `Variable '${key}' is referenced by automation '${rule.title}'`,
      );
    const deleted = await this.persistence.variables.deleteMany({
      id: row.id,
      version,
    });
    if (!deleted.length)
      throw new ConflictError(
        "Variable version changed; reload before deleting",
      );
  }

  /**
   * Read again for each run/effect. Resource status and source authority are
   * live inputs, even when the stored value and its version did not change.
   */
  public async snapshot(rule: Automation, user: UserAccountToken) {
    if (user.id !== rule.authorUserId)
      throw new ForbiddenError("Validate a run as its immutable author");
    try {
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
      return rows.map(({ key, version, value }) => ({ key, version, value }));
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : "Variable or rule validation failed";
      const latest = await this.persistence.rules.findById(rule.id);
      if (
        latest &&
        latest.revision === rule.revision &&
        !latest.requiresApproval
      )
        await this.evidence.transition(
          rule.id,
          "paused",
          reason.slice(0, 1024),
          true,
        );
      throw error;
    }
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
}
