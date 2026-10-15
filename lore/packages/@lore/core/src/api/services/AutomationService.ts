import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { DbCacheProvider, sql, type SQLLike } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { ConflictError, NotFoundError, ForbiddenError } from "alepha/server";

import { automations, type Automation } from "../entities/automations.ts";
import type { AutomationVariable } from "../entities/automationVariables.ts";
import { users } from "../entities/users.ts";
import { AutomationCron } from "../schemas/AutomationCron.ts";
import {
  automationListQuerySchema,
  type AutomationListQuery,
} from "../schemas/automationListQuerySchema.ts";
import {
  automationPageQuerySchema,
  type AutomationPageQuery,
} from "../schemas/automationPageQuerySchema.ts";
import { automationResourceSchema } from "../schemas/automationResourceSchema.ts";
import { automationRunResourceSchema } from "../schemas/automationRunResourceSchema.ts";
import type { AutomationTestSource } from "../schemas/automationTestSourceSchema.ts";
import {
  automationWriteBodySchema,
  type AutomationWriteBody,
} from "../schemas/automationWriteBodySchema.ts";
import { AutomationAccess } from "./AutomationAccess.ts";
import { AutomationApprovalFence } from "./AutomationApprovalFence.ts";
import { AutomationBatchRepository } from "./AutomationBatchRepository.ts";
import { AutomationCatalog } from "./AutomationCatalog.ts";
import { AutomationConfigurationWrites } from "./AutomationConfigurationWrites.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationEvaluator } from "./AutomationEvaluator.ts";
import { AutomationGuards } from "./AutomationGuards.ts";
import { AutomationHealth } from "./AutomationHealth.ts";
import { AutomationMutationAudit } from "./AutomationMutationAudit.ts";
import { AutomationNotificationOutbox } from "./AutomationNotificationOutbox.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { AutomationRunEvidence } from "./AutomationRunEvidence.ts";
import { AutomationVariables } from "./AutomationVariables.ts";

/**
 * The single application boundary for HTTP, MCP and trusted preset creation.
 * Clients supply configuration and a revision, never execution identity.
 */
export class AutomationService {
  protected readonly database = $inject(AutomationDatabase);
  protected readonly outbox = $inject(AutomationNotificationOutbox);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly access = $inject(AutomationAccess);
  protected readonly catalog = $inject(AutomationCatalog);
  protected readonly approvals = $inject(AutomationApprovalFence);
  protected readonly writes = $inject(AutomationConfigurationWrites);
  protected readonly rows = $inject(AutomationBatchRepository.of(automations));
  protected readonly userRows = $inject(AutomationBatchRepository.of(users));
  protected readonly cache = $inject(DbCacheProvider);
  protected readonly health = $inject(AutomationHealth);
  protected readonly variables = $inject(AutomationVariables);
  protected readonly evidence = $inject(AutomationRunEvidence);
  protected readonly evaluator = $inject(AutomationEvaluator);
  protected readonly audit = $inject(AutomationMutationAudit);
  protected readonly guards = $inject(AutomationGuards);
  protected readonly cron = $inject(AutomationCron);
  protected readonly time = $inject(DateTimeProvider);

  public async create(
    projectId: number,
    user: UserAccountToken,
    input: AutomationWriteBody,
    presetKey?: string,
  ) {
    return this.database.primary(async () => {
      await this.access.assert(projectId, user, "automation:write");
      const body = automationWriteBodySchema.parse(input);
      const provenance = await this.access.provenance(user);
      const now = this.time.nowISOString();
      const id = crypto.randomUUID();
      const candidate = {
        id,
        projectId,
        authorUserId: user.id,
        ...provenance,
        title: body.title,
        rule: body.rule,
        enabled: false,
        health: "active",
        requiresApproval: false,
        revision: 0,
        version: 0,
        approvedVariables: [],
        healthCheckedAt: 0,
        createdAt: now,
        updatedAt: now,
        activatedAt: now,
        ...(presetKey ? { presetKey } : {}),
      } satisfies Automation;
      const prepared = await this.prepare(candidate);
      const data = {
        ...candidate,
        approvedVariables: prepared.approved,
        scheduleCron: prepared.scheduleCron,
      };
      await this.writes.commit(
        projectId,
        this.approvals.current(projectId, prepared.approved),
        [
          this.rows.insertStatement(data),
          this.audit.statement(projectId, user, "create", id, {
            revision: 0,
            authorUserId: user.id,
          }),
        ],
      );
      await this.cache.invalidateTable("automations");
      await this.cache.invalidateTable("audits");
      await this.audit.activity(projectId, user, "create");
      return this.get(projectId, id, user);
    });
  }
  public async update(
    projectId: number,
    id: string,
    user: UserAccountToken,
    expectedRevision: number,
    input: AutomationWriteBody,
  ) {
    return this.database.primary(async () => {
      const rule = await this.stored(projectId, id);
      await this.access.assertMutation(rule, user, "edit");
      this.revision(rule, expectedRevision);
      const body = automationWriteBodySchema.parse(input);
      const provenance = await this.access.provenance(user);
      const candidate: Automation = {
        ...rule,
        ...this.clearProvenance(),
        ...provenance,
        title: body.title,
        rule: body.rule,
      };
      const prepared = await this.prepare(candidate);
      const decision = rule.requiresApproval
        ? {
            health: "paused" as const,
            requiresApproval: true,
            reason: rule.reason,
          }
        : {
            health: "active" as const,
            requiresApproval: false,
            reason: undefined,
          };
      const now = this.time.nowISOString();
      const patch = {
        title: body.title,
        rule: body.rule,
        ...this.clearProvenancePatch(),
        ...provenance,
        approvedVariables: prepared.approved,
        scheduleCron: prepared.scheduleCron ?? null,
        nextRunAt:
          rule.enabled && prepared.scheduleCron
            ? this.cron.next(prepared.scheduleCron, now)
            : null,
        revision: rule.revision + 1,
        activatedAt: now,
        health: decision.health,
        reason: decision.reason ?? null,
        requiresApproval: decision.requiresApproval,
        ...((await this.guards.configurationChanged(rule.rule, body.rule))
          ? { baseline: null }
          : {}),
        updatedAt: now,
      };
      const condition = this.approvals.current(
        rule.projectId,
        prepared.approved,
      );
      if (
        rule.health !== decision.health ||
        rule.reason !== decision.reason ||
        rule.requiresApproval !== decision.requiresApproval
      ) {
        const changed = await this.evidence.transition(
          id,
          decision.health,
          decision.reason,
          decision.requiresApproval,
          {
            expectedVersion: rule.version,
            condition,
            patch,
            statements: [
              this.audit.statement(projectId, user, "update", id, {
                revision: patch.revision,
                authorUserId: rule.authorUserId,
              }),
            ],
            changedTables: ["audits"],
          },
        );
        if (!changed)
          throw new ConflictError("Automation changed; reload before writing");
        await this.audit.activity(projectId, user, "update");
      } else await this.write(rule, user, "update", patch, condition);
      return this.get(projectId, id, user);
    });
  }
  public async setEnabled(
    projectId: number,
    id: string,
    user: UserAccountToken,
    enabled: boolean,
    expectedRevision: number,
  ) {
    return this.database.primary(async () => {
      const rule = await this.stored(projectId, id);
      await this.access.assertMutation(
        rule,
        user,
        enabled ? "enable" : "disable",
      );
      const context = await this.access.authorize(
        projectId,
        user,
        rule.authorUserId === user.id
          ? "automation:write"
          : "automation:manage",
      );
      this.revision(rule, expectedRevision);
      const provenance = enabled
        ? await this.access.provenance(user)
        : undefined;
      const candidate: Automation = enabled
        ? { ...rule, ...this.clearProvenance(), ...provenance }
        : rule;
      const prepared = enabled ? await this.prepare(candidate) : undefined;
      const now = this.time.nowISOString();
      const changed = await this.evidence.transition(
        id,
        enabled ? "active" : rule.health,
        enabled ? undefined : rule.reason,
        enabled ? false : rule.requiresApproval,
        {
          expectedVersion: rule.version,
          ...(prepared
            ? {
                condition: this.approvals.current(
                  rule.projectId,
                  prepared.approved,
                ),
              }
            : {}),
          patch: {
            enabled,
            revision: rule.revision + 1,
            activatedAt: now,
            ...(enabled
              ? {
                  ...this.clearProvenancePatch(),
                  ...provenance,
                  approvedVariables: prepared!.approved,
                }
              : {}),
            scheduleCron: prepared
              ? (prepared.scheduleCron ?? null)
              : (rule.scheduleCron ?? null),
            nextRunAt:
              enabled && prepared?.scheduleCron
                ? this.cron.next(prepared.scheduleCron, now)
                : null,
          },
          statements: [
            this.audit.statement(
              rule.projectId,
              user,
              enabled ? "enable" : "disable",
              id,
              { revision: rule.revision + 1, authorUserId: rule.authorUserId },
            ),
          ],
          changedTables: ["audits"],
        },
      );
      if (!changed)
        throw new ConflictError(
          "Automation changed; reload before changing its enable switch",
        );
      await this.audit.activity(
        projectId,
        user,
        enabled ? "enable" : "disable",
      );
      return this.resource(
        await this.persistence.rules.getById(id),
        user,
        context.permissions,
      );
    });
  }
  public async remove(
    projectId: number,
    id: string,
    user: UserAccountToken,
    expectedRevision: number,
  ): Promise<void> {
    return this.database.primary(async () => {
      const rule = await this.stored(projectId, id);
      await this.access.assertMutation(rule, user, "delete");
      this.revision(rule, expectedRevision);
      await this.write(rule, user, "delete", {
        enabled: false,
        revision: rule.revision + 1,
        deletedAt: this.time.nowISOString(),
        nextRunAt: null,
      });
    });
  }
  public async get(projectId: number, id: string, user: UserAccountToken) {
    return this.database.primary(async () => {
      const rule = await this.stored(projectId, id);
      const context = await this.access.authorize(
        rule.projectId,
        user,
        "automation:read",
      );
      return this.resource(rule, user, context.permissions);
    });
  }
  public async list(
    projectId: number,
    user: UserAccountToken,
    input: Partial<AutomationListQuery> = {},
  ) {
    return this.database.primary(async () => {
      const query = automationListQuerySchema.parse(input);
      const context = await this.access.authorize(
        projectId,
        user,
        "automation:read",
      );
      const rows = await this.persistence.rules.findMany({
        where: {
          projectId,
          ...(query.search ? { title: { ilike: `%${query.search}%` } } : {}),
          ...(query.authorUserId ? { authorUserId: query.authorUserId } : {}),
          ...(query.state === "disabled"
            ? { enabled: false }
            : query.state
              ? { enabled: true, health: query.state }
              : {}),
        },
        orderBy: [
          { column: "createdAt", direction: "desc" },
          { column: "id", direction: "desc" },
        ],
        offset: query.offset,
        limit: query.limit + 1,
      });
      const items = [];
      for (const rule of rows.slice(0, query.limit))
        items.push(await this.resource(rule, user, context.permissions));
      return {
        items,
        hasMore: rows.length > query.limit,
        ...(rows.length > query.limit
          ? { nextOffset: query.offset + query.limit }
          : {}),
      };
    });
  }
  public async runs(
    projectId: number,
    id: string,
    user: UserAccountToken,
    input: Partial<AutomationPageQuery> = {},
  ) {
    return this.database.primary(async () => {
      const rule = await this.stored(projectId, id, true);
      await this.access.assert(rule.projectId, user, "automation:read");
      const query = automationPageQuerySchema.parse(input);
      const rows = await this.persistence.runs.findMany({
        where: { automationId: id },
        orderBy: [
          { column: "createdAt", direction: "desc" },
          { column: "id", direction: "desc" },
        ],
        offset: query.offset,
        limit: query.limit + 1,
      });
      const items = [];
      for (const run of rows.slice(0, query.limit))
        items.push(await this.run(projectId, run.id, user));
      return {
        items,
        hasMore: rows.length > query.limit,
        ...(rows.length > query.limit
          ? { nextOffset: query.offset + query.limit }
          : {}),
      };
    });
  }
  public async run(projectId: number, id: string, user: UserAccountToken) {
    await this.access.assert(projectId, user, "automation:read");
    await this.persistence.runs.getOne({ where: { id, projectId } });
    const run = await this.evidence.read(id, user);
    // Read delivery evidence only after current source and variable access
    // has authorized the immutable run payload.
    const enqueues = (run.snapshot?.actions ?? []).filter(
      (action) =>
        action.result.enqueued === true &&
        typeof action.result.outbox_id === "string" &&
        run.snapshot?.rule?.actions[action.index]?.kind === "notify",
    );
    const outcomes = await this.outbox.statuses(
      enqueues.map((action) => String(action.result.outbox_id)),
    );
    const notifications = enqueues.map((action) => ({
      index: action.index,
      ...(action.row === undefined ? {} : { row: action.row }),
      outboxId: action.result.outbox_id,
      ...outcomes.get(String(action.result.outbox_id)),
    }));
    return automationRunResourceSchema.parse({
      notifications,
      id: run.id,
      projectId: run.projectId,
      automationId: run.automationId,
      ruleRevision: run.ruleRevision,
      occurrenceId: run.occurrenceId,
      triggeredAt: run.triggeredAt,
      status: run.status,
      reason: run.redacted
        ? "Current source access is unavailable"
        : run.reason,
      snapshot: run.snapshot,
      redacted: run.redacted,
      redactionReason: run.redactionReason,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
    });
  }
  public test(
    projectId: number,
    id: string,
    user: UserAccountToken,
    source?: AutomationTestSource,
  ) {
    return this.database.primary(async () => {
      await this.stored(projectId, id);
      return this.evaluator.test(id, user, source);
    });
  }
  public catalogue(projectId: number, user: UserAccountToken) {
    return this.catalog.describe(projectId, user);
  }

  protected async stored(
    projectId: number,
    id: string,
    force = false,
  ): Promise<Automation> {
    const rule = await this.persistence.rules.getById(id, { force });
    if (rule.projectId !== projectId)
      throw new NotFoundError("Automation is not in this project");
    return rule;
  }
  protected async prepare(rule: Automation) {
    const author = await this.access.author(rule);
    await this.access.assert(rule.projectId, author, "automation:write");
    const values = await this.variables.snapshot(rule, author, {
      transition: false,
    });
    const compiled = await this.catalog.compile(
      rule.projectId,
      author,
      rule.rule,
      new Map(
        values.map((value) => [
          value.key,
          { ...value, projectId: rule.projectId } as AutomationVariable,
        ]),
      ),
    );
    return {
      approved: this.approvals.capture(values),
      scheduleCron: compiled.scheduleCron,
    };
  }
  protected revision(rule: Automation, expected: number) {
    if (!Number.isSafeInteger(expected) || expected !== rule.revision)
      throw new ConflictError(
        "Automation revision changed; reload before writing",
      );
  }
  protected clearProvenance() {
    return {
      authorKeyId: undefined,
      authorSessionId: undefined,
      authorScope: undefined,
    };
  }
  protected clearProvenancePatch() {
    return { authorKeyId: null, authorSessionId: null, authorScope: null };
  }
  protected async write(
    rule: Automation,
    user: UserAccountToken,
    action: string,
    patch: Parameters<
      AutomationBatchRepository<typeof automations.schema>["updateStatement"]
    >[1],
    condition: SQLLike = sql`TRUE`,
  ) {
    try {
      await this.writes.commit(
        rule.projectId,
        sql`${this.rows.exists({ id: rule.id, version: rule.version, revision: rule.revision })} AND (${typeof condition === "string" ? sql.raw(condition) : condition.getSQL()})`,
        [
          this.rows.updateStatement(
            { id: rule.id, version: rule.version, revision: rule.revision },
            patch,
          ),
          this.audit.statement(rule.projectId, user, action, rule.id, {
            revision: rule.revision + 1,
            authorUserId: rule.authorUserId,
          }),
        ],
      );
    } catch (error) {
      if (
        (await this.persistence.rules.findById(rule.id))?.version !==
        rule.version
      )
        throw new ConflictError("Automation changed; reload before writing");
      throw error;
    }
    await this.cache.invalidateTable("automations");
    await this.cache.invalidateTable("audits");
    await this.audit.activity(rule.projectId, user, action);
  }
  protected async resource(
    rule: Automation,
    user: UserAccountToken,
    permissions: string[],
  ) {
    let reason: string | undefined;
    try {
      reason = await this.catalog.sourceAvailability(
        rule.projectId,
        user,
        rule.rule,
      );
    } catch (error) {
      if (!(error instanceof ForbiddenError)) throw error;
      reason = "Current source access is unavailable";
    }
    if (!reason) {
      const keys = [...this.variables.references(rule.rule)];
      const values = keys.length
        ? await this.persistence.variables.findMany({
            where: { projectId: rule.projectId, key: { inArray: keys } },
            limit: 64,
          })
        : [];
      for (const value of values)
        if (
          !(await this.catalog.inspectVariable(rule.projectId, user, value))
            .available
        ) {
          reason = "Variable source access is unavailable";
          break;
        }
    }
    const author = (
      await this.userRows.findMany({
        where: { id: rule.authorUserId },
        columns: ["id", "firstName", "lastName"],
        limit: 1,
      })
    )[0];
    const last = (
      await this.persistence.runs.findMany({
        where: { automationId: rule.id, occurrenceId: { notLike: "health:%" } },
        columns: ["id", "status", "createdAt"],
        orderBy: [
          { column: "createdAt", direction: "desc" },
          { column: "id", direction: "desc" },
        ],
        limit: 1,
      })
    )[0];
    const own = user.id === rule.authorUserId;
    const write = permissions.includes("automation:write");
    const manage = permissions.includes("automation:manage");
    return automationResourceSchema.parse({
      id: rule.id,
      projectId: rule.projectId,
      authorUserId: rule.authorUserId,
      authorName: author
        ? [author.firstName, author.lastName].filter(Boolean).join(" ") ||
          undefined
        : undefined,
      title: rule.title,
      enabled: rule.enabled,
      health: rule.health,
      displayState: this.health.display(rule),
      requiresApproval: rule.requiresApproval,
      reason:
        reason && rule.reason
          ? "Current source access is unavailable"
          : rule.reason,
      revision: rule.revision,
      rule: reason ? null : rule.rule,
      redacted: !!reason,
      ...(reason
        ? { redactionReason: "Current source access is unavailable" }
        : {}),
      presetKey: rule.presetKey,
      nextRunAt: rule.nextRunAt,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
      ...(last
        ? { lastRun: { id: last.id, status: last.status, at: last.createdAt } }
        : {}),
      canEdit: own && write,
      canEnable: own && write,
      canDisable: (own && write) || manage,
      canDelete: (own && write) || manage,
    });
  }
}
