import { $inject, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { DbCacheProvider, sql, type SQLLike } from "alepha/orm";
import { BadRequestError, ConflictError } from "alepha/server";

import type { AutomationReceipt } from "../entities/automationReceipts.ts";
import type { AutomationRule } from "../schemas/automationRuleSchema.ts";
import { AutomationAtomic } from "./AutomationAtomic.ts";
import { AutomationAuthority } from "./AutomationAuthority.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationIdentity } from "./AutomationIdentity.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import {
  AutomationRunEvidence,
  type AutomationPreparedEvidence,
} from "./AutomationRunEvidence.ts";

/**
 * Occurrence identity survives rule edits and detail pruning. The partial
 * unique index grants one live occurrence per rule across all isolates.
 */
export class AutomationClaims {
  protected readonly cache = $inject(DbCacheProvider);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly database = $inject(AutomationDatabase);
  protected readonly atomic = $inject(AutomationAtomic);
  protected readonly authority = $inject(AutomationAuthority);
  protected readonly evidence = $inject(AutomationRunEvidence);
  protected readonly identity = $inject(AutomationIdentity);
  protected readonly dateTime = $inject(DateTimeProvider);

  protected recoveryConsumer?: (receipt: AutomationReceipt) => Promise<void>;

  public registerRecovery(
    consumer: (receipt: AutomationReceipt) => Promise<void>,
  ): void {
    if (this.recoveryConsumer)
      throw new AlephaError(
        "An automation recovery consumer is already registered",
      );
    this.recoveryConsumer = consumer;
  }

  public async sweepRecovery(limit: number): Promise<number> {
    if (!this.recoveryConsumer) return 0;
    await this.repairTerminals();
    const now = this.dateTime.nowISOString();
    const pending = await this.persistence.receipts.findMany({
      where: {
        kind: "occurrence",
        status: "ready",
        replayUntil: { gt: now },
        or: [{ leaseUntil: { isNull: true } }, { leaseUntil: { lte: now } }],
      },
      orderBy: [
        { column: "queueAttempts", direction: "asc" },
        { column: "createdAt", direction: "asc" },
        { column: "id", direction: "asc" },
      ],
      limit: Math.min(limit, 50),
    });
    let queued = 0;
    for (const receipt of pending) {
      const acquired = await this.persistence.receipts.updateMany(
        { id: receipt.id, version: receipt.version, status: "ready" },
        {
          queueAttempts: receipt.queueAttempts + 1,
          leaseUntil: this.dateTime.now().add(2, "minutes").toISOString(),
        },
      );
      if (!acquired.length) continue;
      await this.recoveryConsumer(
        await this.persistence.receipts.getById(receipt.id),
      );
      queued += 1;
    }
    const receipts = queued < limit ? await this.recover(limit - queued) : [];
    for (const receipt of receipts) await this.recoveryConsumer(receipt);
    return queued + receipts.length;
  }

  /**
   * Dispatch only reserves immutable source/configuration intent. Evaluation
   * and effects happen in bounded worker steps under the current author.
   */
  public async reserve(input: {
    automationId: string;
    revision: number;
    source:
      | { kind: "event"; eventId: string }
      | { kind: "schedule"; scheduledAt: string };
    condition?: SQLLike;
    mutation?: SQLLike;
    changedTables?: string[];
  }): Promise<AutomationReceipt> {
    return this.database.primary(async () => {
      const rule = await this.persistence.rules.getById(input.automationId);
      let occurredAt: string;
      let occurrenceId: string;
      let fields: Record<string, unknown> = {};
      if (input.source.kind === "event") {
        const event = await this.persistence.events.getById(
          input.source.eventId,
        );
        if (
          event.projectId !== rule.projectId ||
          rule.rule.trigger.kind !== "event" ||
          rule.rule.trigger.event !== event.name
        )
          throw new BadRequestError(
            "Event does not belong to this rule's project and source",
          );
        occurredAt = event.occurredAt;
        occurrenceId = `event:${event.id}`;
        fields = event.payload.fields;
      } else {
        if (rule.rule.trigger.kind !== "schedule")
          throw new BadRequestError(
            "Event rules cannot reserve scheduled occurrences",
          );
        const date = new Date(input.source.scheduledAt);
        if (!Number.isFinite(date.getTime()))
          throw new BadRequestError("Invalid scheduled occurrence");
        occurredAt = date.toISOString();
        occurrenceId = `schedule:${occurredAt}`;
      }
      const id = await this.identity.hash([
        "occurrence",
        rule.id,
        occurrenceId,
      ]);
      const existing = await this.persistence.receipts.findById(id);
      if (existing) return existing;
      const frame = await this.evidence.prepare({
        rule,
        occurrenceId,
        triggeredAt: occurredAt,
        inputs: fields,
      });
      delete frame.snapshot.evaluatedAt;
      const now = this.dateTime.nowISOString();
      const replayUntil = new Date(
        new Date(occurredAt).getTime() + 90 * 86_400_000,
      ).toISOString();
      const status =
        frame.status === "refused" || replayUntil <= now || occurredAt > now
          ? "refused"
          : "ready";
      const reason =
        frame.reason ??
        (replayUntil <= now
          ? "Occurrence is outside the 90-day replay horizon"
          : occurredAt > now
            ? "Occurrence is not due"
            : undefined);
      const runId = crypto.randomUUID();
      try {
        await this.atomic.guarded(
          rule.projectId,
          sql`NOT EXISTS (SELECT 1 FROM automation_receipts WHERE id = ${id}) AND EXISTS (SELECT 1 FROM automations WHERE id = ${rule.id} AND revision = ${input.revision} AND enabled = TRUE AND health = 'active' AND requires_approval = FALSE AND deleted_at IS NULL) ${input.condition ? sql`AND (${typeof input.condition === "string" ? sql.raw(input.condition) : input.condition.getSQL()})` : sql``}`,
          [
            ...(input.mutation ? [input.mutation] : []),
            sql`INSERT INTO automation_receipts (id, version, project_id, automation_id, identity, kind, status, occurrence_id, rule_revision, occurred_at, replay_until, run_id, snapshot, reason, cursor, queue_attempts, roster_complete, created_at, updated_at)
              VALUES (${id}, 0, ${rule.projectId}, ${rule.id}, ${id}, 'occurrence', ${status}, ${occurrenceId}, ${input.revision}, ${this.database.timestamp(occurredAt)}, ${this.database.timestamp(replayUntil)}, ${runId}, ${JSON.stringify(frame.snapshot)}, ${reason ?? null}, 0, 0, FALSE, ${this.database.timestamp(now)}, ${this.database.timestamp(now)})`,
          ],
        );
      } catch (error) {
        const raced = await this.persistence.receipts.findById(id);
        if (raced) return raced;
        throw error;
      }
      for (const table of new Set([
        ...(input.changedTables ?? []),
        "automation_receipts",
      ]))
        await this.cache.invalidateTable(table);
      const receipt = await this.persistence.receipts.getById(id);
      if (status === "refused") {
        await this.evidence.persist({
          id: runId,
          rule: { ...rule, revision: input.revision },
          occurrenceId,
          triggeredAt: occurredAt,
          prepared: { ...frame, status: "refused", reason },
        });
        return this.persistence.receipts.updateById(id, { snapshot: null });
      }
      return receipt;
    });
  }

  protected async activateReady(
    receipt: AutomationReceipt,
    prepared: AutomationPreparedEvidence,
  ): Promise<{
    state: "claimed" | "busy" | "terminal";
    receipt?: AutomationReceipt;
  }> {
    let reason = prepared.reason;
    let refused = prepared.status === "refused" || !prepared.snapshot.rule;
    try {
      if (receipt.replayUntil <= this.dateTime.nowISOString())
        throw new ConflictError(
          "Occurrence is outside the 90-day replay horizon",
        );
      const current = await this.authority.check({
        automationId: receipt.automationId!,
        revision: receipt.ruleRevision,
        variables: prepared.snapshot.variables,
      });
      if (
        prepared.snapshot.rule &&
        (await this.identity.hash(prepared.snapshot.rule)) !==
          (await this.identity.hash(current.rule.rule))
      )
        throw new ConflictError(
          "Prepared rule differs from the reserved revision",
        );
    } catch (error) {
      refused = true;
      reason =
        error instanceof Error
          ? error.message.slice(0, 1024)
          : "Current author authority is unavailable";
    }
    const now = this.dateTime.nowISOString();
    const token = crypto.randomUUID();
    let rows: Array<Record<string, unknown>[]>;
    try {
      rows = await this.database.batch([
        sql`UPDATE automation_receipts SET status = ${refused ? "refused" : "claimed"}, snapshot = ${JSON.stringify(prepared.snapshot)}, lease_token = ${refused ? null : token}, lease_until = ${refused ? null : this.database.timestamp(this.dateTime.now().add(2, "minutes").toISOString())}, reason = ${reason ?? null}, version = version + 1, updated_at = ${this.database.timestamp(now)} WHERE id = ${receipt.id} AND status = 'ready' AND version = ${receipt.version} AND (${refused ? 1 : 0} = 1 OR EXISTS (SELECT 1 FROM automations WHERE id = ${receipt.automationId} AND revision = ${receipt.ruleRevision} AND enabled = TRUE AND health = 'active' AND requires_approval = FALSE AND deleted_at IS NULL)) RETURNING id`,
      ]);
    } catch {
      return { state: "busy" };
    }
    if (!rows[0].length) return { state: "busy" };
    let active: AutomationReceipt = await this.persistence.receipts.getById(
      receipt.id,
    );
    const rule = await this.persistence.rules.getById(receipt.automationId!, {
      force: true,
    });
    await this.evidence.persist({
      id: active.runId,
      rule: { ...rule, revision: receipt.ruleRevision },
      occurrenceId: receipt.occurrenceId,
      triggeredAt: receipt.occurredAt,
      prepared: {
        ...prepared,
        ...(refused ? { status: "refused", reason } : {}),
      },
    });
    if (refused)
      active = await this.persistence.receipts.updateById(active.id, {
        snapshot: null,
      });
    return { state: refused ? "terminal" : "claimed", receipt: active };
  }

  public async claim(input: {
    automationId: string;
    revision: number;
    source:
      | { kind: "event"; eventId: string }
      | { kind: "schedule"; scheduledAt: string };
    prepared: AutomationPreparedEvidence;
  }): Promise<{
    state: "claimed" | "busy" | "terminal";
    receipt?: AutomationReceipt;
  }> {
    return this.database.primary(async () => {
      const rule = await this.persistence.rules.getById(input.automationId);
      let occurredAt: string;
      let occurrenceId: string;
      let dispatched = false;
      if (input.source.kind === "event") {
        const event = await this.persistence.events.getById(
          input.source.eventId,
        );
        if (
          event.projectId !== rule.projectId ||
          rule.rule.trigger.kind !== "event" ||
          rule.rule.trigger.event !== event.name
        )
          throw new BadRequestError(
            "Event does not belong to this rule's project and source",
          );
        dispatched = !!event.dispatchedAt;
        occurredAt = event.occurredAt;
        occurrenceId = `event:${event.id}`;
      } else {
        if (rule.rule.trigger.kind !== "schedule")
          throw new BadRequestError(
            "Event rules cannot claim scheduled occurrences",
          );
        const parsed = new Date(input.source.scheduledAt);
        if (!Number.isFinite(parsed.getTime()))
          throw new BadRequestError("Invalid scheduled occurrence");
        occurredAt = parsed.toISOString();
        occurrenceId = `schedule:${occurredAt}`;
      }
      const id = await this.identity.hash([
        "occurrence",
        rule.id,
        occurrenceId,
      ]);
      const existing = await this.persistence.receipts.findById(id);
      if (existing?.status === "ready")
        return this.activateReady(existing, input.prepared);
      if (existing) return this.reacquire(existing);
      if (dispatched)
        throw new ConflictError("Source event was already dispatched");
      let status: AutomationReceipt["status"] = "claimed";
      let reason = input.prepared.reason;
      const now = this.dateTime.nowISOString();
      const replayUntil = new Date(
        new Date(occurredAt).getTime() + 90 * 86_400_000,
      ).toISOString();
      if (replayUntil <= now || occurredAt > now) {
        status = "refused";
        reason =
          replayUntil <= now
            ? "Occurrence is outside the 90-day replay horizon"
            : "Occurrence is not due";
      }
      if (input.prepared.status === "refused" || !input.prepared.snapshot.rule)
        status = "refused";
      try {
        await this.authority.check({
          automationId: rule.id,
          revision: input.revision,
          variables: input.prepared.snapshot.variables,
        });
        if (
          input.prepared.snapshot.rule &&
          (await this.identity.hash(input.prepared.snapshot.rule)) !==
            (await this.identity.hash(rule.rule))
        )
          throw new ConflictError(
            "Prepared rule differs from the claimed revision",
          );
      } catch (error) {
        status = "refused";
        reason =
          error instanceof Error
            ? error.message.slice(0, 1024)
            : "Current author authority is unavailable";
      }
      const leaseToken = crypto.randomUUID();
      const runId = crypto.randomUUID();
      const leaseUntil = this.dateTime.now().add(2, "minutes").toISOString();
      const active = status === "claimed";
      const inserted = await this.database.batch([
        sql`INSERT INTO automation_receipts (id, version, project_id, automation_id, identity, kind, status, occurrence_id, rule_revision, occurred_at, replay_until, lease_token, lease_until, run_id, snapshot, reason, cursor, roster_complete, created_at, updated_at)
            SELECT ${id}, 0, ${rule.projectId}, ${rule.id}, ${id}, 'occurrence', ${status}, ${occurrenceId}, ${input.revision}, ${this.database.timestamp(occurredAt)}, ${this.database.timestamp(replayUntil)}, ${active ? leaseToken : null}, ${active ? this.database.timestamp(leaseUntil) : null}, ${runId}, ${JSON.stringify(input.prepared.snapshot)}, ${reason ?? null}, 0, FALSE, ${this.database.timestamp(now)}, ${this.database.timestamp(now)}
            WHERE ${active ? 1 : 0} = 0 OR EXISTS (SELECT 1 FROM automations WHERE id = ${rule.id} AND revision = ${input.revision} AND enabled = TRUE AND health = 'active' AND requires_approval = FALSE AND deleted_at IS NULL)
            ON CONFLICT DO NOTHING RETURNING id`,
      ]);
      if (!inserted[0].length) {
        const raced = await this.persistence.receipts.findById(id);
        return raced ? this.reacquire(raced) : { state: "busy" };
      }
      const receipt = await this.persistence.receipts.getById(id);
      await this.evidence.persist({
        id: runId,
        rule: { ...rule, revision: input.revision },
        occurrenceId,
        triggeredAt: occurredAt,
        prepared: {
          ...input.prepared,
          ...(active ? {} : { status: "refused", reason }),
        },
      });
      if (!active)
        await this.persistence.receipts.updateById(receipt.id, {
          snapshot: null,
        });
      return {
        state: active ? "claimed" : "terminal",
        receipt: active
          ? receipt
          : await this.persistence.receipts.getById(receipt.id),
      };
    });
  }

  protected async reacquire(receipt: AutomationReceipt): Promise<{
    state: "claimed" | "busy" | "terminal";
    receipt?: AutomationReceipt;
  }> {
    if (receipt.status !== "claimed") return { state: "terminal", receipt };
    const now = this.dateTime.nowISOString();
    if (receipt.leaseUntil && receipt.leaseUntil > now)
      return { state: "busy", receipt };
    const acquired = await this.persistence.receipts.updateMany(
      {
        id: receipt.id,
        version: receipt.version,
        status: "claimed",
        or: [{ leaseUntil: { isNull: true } }, { leaseUntil: { lte: now } }],
      },
      {
        leaseToken: crypto.randomUUID(),
        leaseUntil: this.dateTime.now().add(2, "minutes").toISOString(),
      },
    );
    if (!acquired.length) return { state: "busy" };
    receipt = await this.persistence.receipts.getById(receipt.id);
    const external = await this.persistence.receipts.findMany({
      where: {
        parentId: receipt.id,
        kind: "action",
        status: "claimed",
        mode: "external",
      },
      limit: 100,
    });
    const uncertain = external.filter(
      (action) => action.result?.started === true,
    );
    if (uncertain.length) {
      await this.persistence.receipts.updateMany(
        {
          id: { inArray: uncertain.map((action) => action.id) },
          status: "claimed",
        },
        {
          status: "unknown",
          reason: "External outcome was not confirmed before lease recovery",
        },
      );
      const updated = await this.persistence.receipts.updateById(receipt.id, {
        version: receipt.version,
        status: "unknown",
        reason: "External action outcome is unknown",
        leaseToken: null,
        leaseUntil: null,
      });
      await this.reconcileRun(updated, "unknown");
      await this.closePending(updated);
      await this.evidence.transition(
        receipt.automationId!,
        "paused",
        "An action outcome is unknown; author review is required",
        true,
      );
      return { state: "terminal", receipt: updated };
    }
    try {
      if (receipt.replayUntil <= now)
        throw new ConflictError(
          "Occurrence is outside the 90-day replay horizon",
        );
      await this.authority.check({
        automationId: receipt.automationId!,
        revision: receipt.ruleRevision,
        variables: receipt.snapshot?.variables,
      });
    } catch (error) {
      const updated = await this.persistence.receipts.updateById(receipt.id, {
        version: receipt.version,
        status: "refused",
        reason: (error instanceof Error
          ? error.message
          : "Occurrence cannot resume"
        ).slice(0, 1024),
        leaseToken: null,
        leaseUntil: null,
      });
      await this.reconcileRun(updated, "refused");
      await this.closePending(updated);
      return { state: "terminal", receipt: updated };
    }
    if (receipt.runId && receipt.snapshot) await this.ensureRun(receipt);
    return { state: "claimed", receipt };
  }

  public async lease(id: string, token: string): Promise<AutomationReceipt> {
    return this.database.primary(async () => {
      const receipt = await this.persistence.receipts.getById(id);
      const now = this.dateTime.nowISOString();
      if (
        receipt.kind !== "occurrence" ||
        receipt.status !== "claimed" ||
        receipt.leaseToken !== token ||
        !receipt.leaseUntil ||
        receipt.leaseUntil <= now ||
        receipt.replayUntil <= now
      )
        throw new ConflictError("Occurrence lease is no longer current");
      await this.authority.check({
        automationId: receipt.automationId!,
        revision: receipt.ruleRevision,
        variables: receipt.snapshot?.variables,
      });
      return receipt;
    });
  }

  public async renew(id: string, token: string): Promise<AutomationReceipt> {
    const receipt = await this.lease(id, token);
    return this.persistence.receipts.updateById(id, {
      version: receipt.version,
      leaseUntil: this.dateTime.now().add(2, "minutes").toISOString(),
    });
  }

  public async yield(id: string, token: string): Promise<void> {
    await this.lease(id, token);
    await this.persistence.receipts.updateMany(
      { id, leaseToken: token, status: "claimed" },
      { leaseToken: null, leaseUntil: this.dateTime.nowISOString() },
    );
  }

  public async recover(limit = 50): Promise<AutomationReceipt[]> {
    return this.database.primary(async () => {
      const rows = await this.persistence.receipts.findMany({
        where: {
          kind: "occurrence",
          status: "claimed",
          or: [
            { leaseUntil: { isNull: true } },
            { leaseUntil: { lte: this.dateTime.nowISOString() } },
          ],
        },
        orderBy: [
          { column: "createdAt", direction: "asc" },
          { column: "id", direction: "asc" },
        ],
        limit: Math.min(limit, 50),
      });
      const ready: AutomationReceipt[] = [];
      for (const row of rows) {
        const result = await this.reacquire(row);
        if (result.state === "claimed" && result.receipt)
          ready.push(result.receipt);
      }
      return ready;
    });
  }

  public async complete(
    id: string,
    token: string,
    result: AutomationReceipt["result"] = {},
  ): Promise<void> {
    const occurrence = await this.lease(id, token);
    await this.atomic.guarded(
      occurrence.projectId,
      sql`${this.live(occurrence, token)} AND EXISTS (SELECT 1 FROM automation_receipts WHERE id = ${id} AND cursor >= ${occurrence.snapshot?.actions.length ?? 0}) AND NOT EXISTS (SELECT 1 FROM automation_receipts WHERE parent_id = ${id} AND kind IN ('action', 'recipient', 'roster', 'chunk') AND status = 'claimed')`,
      [
        sql`UPDATE automation_receipts SET status = 'committed', snapshot = NULL, result = ${JSON.stringify(this.safeResult(result ?? {}))}, lease_token = NULL, lease_until = NULL, version = version + 1, updated_at = ${this.database.timestamp(this.dateTime.nowISOString())} WHERE id = ${id}`,
      ],
    );
  }

  public async advance(
    id: string,
    token: string,
    input: { index: number; row?: number; receiptId: string },
  ): Promise<number> {
    const occurrence = await this.lease(id, token);
    const planned = occurrence.snapshot?.actions[occurrence.cursor];
    if (!planned || planned.index !== input.index || planned.row !== input.row)
      throw new ConflictError("Program cursor changed");
    const next = occurrence.cursor + 1;
    await this.atomic.guarded(
      occurrence.projectId,
      sql`${this.live(occurrence, token)} AND EXISTS (SELECT 1 FROM automation_receipts WHERE id = ${input.receiptId} AND parent_id = ${id} AND kind IN ('action', 'roster') AND status IN ('committed', 'skipped') AND action_index = ${input.index} AND ${input.row === undefined ? sql`row_index IS NULL` : sql`row_index = ${input.row}`}) AND EXISTS (SELECT 1 FROM automation_receipts WHERE id = ${id} AND cursor = ${occurrence.cursor})`,
      [
        sql`UPDATE automation_receipts SET cursor = ${next}, version = version + 1, updated_at = ${this.database.timestamp(this.dateTime.nowISOString())} WHERE id = ${id}`,
      ],
    );
    return next;
  }

  public live(receipt: AutomationReceipt, token: string): SQLLike {
    const now = this.dateTime.nowISOString();
    return sql`EXISTS (SELECT 1 FROM automation_receipts WHERE id = ${receipt.id} AND kind = 'occurrence' AND status = 'claimed' AND lease_token = ${token} AND lease_until > ${this.database.timestamp(now)} AND replay_until > ${this.database.timestamp(now)})
      AND EXISTS (SELECT 1 FROM automations WHERE id = ${receipt.automationId} AND revision = ${receipt.ruleRevision} AND enabled = TRUE AND health = 'active' AND requires_approval = FALSE AND deleted_at IS NULL)
      AND EXISTS (SELECT 1 FROM automations AS rule JOIN projects AS project ON project.id = rule.project_id JOIN organization_members AS member ON member.organization_id = project.organization_id AND member.user_id = rule.author_user_id JOIN users AS author ON author.id = rule.author_user_id AND author.enabled = TRUE WHERE rule.id = ${receipt.automationId} AND (rule.author_key_id IS NULL OR EXISTS (SELECT 1 FROM api_keys AS credential WHERE credential.id = rule.author_key_id AND credential.user_id = author.id AND credential.revoked_at IS NULL AND (credential.expires_at IS NULL OR credential.expires_at > ${this.database.timestamp(now)}))))`;
  }

  public async actionIdentity(
    occurrence: AutomationReceipt,
    input: { index: number; row?: number; deliveryKey?: string },
  ) {
    return this.identity.hash([
      "action",
      occurrence.id,
      input.index,
      input.row ?? null,
      input.deliveryKey ?? null,
    ]);
  }

  public async beginAction(
    id: string,
    token: string,
    input: AutomationEffectInput,
  ): Promise<AutomationReceipt> {
    return this.database.primary(async () => {
      const occurrence = await this.lease(id, token);
      if (input.deliveryKey && input.action.kind !== "notify")
        throw new BadRequestError(
          "Only notification deliveries may fan out a program step",
        );
      await this.authority.check({
        automationId: occurrence.automationId!,
        revision: occurrence.ruleRevision,
        variables: occurrence.snapshot?.variables,
        effect: { index: input.index, action: input.action },
      });
      if (
        !occurrence.snapshot?.actions.some(
          (planned) =>
            planned.index === input.index && planned.row === input.row,
        )
      )
        throw new BadRequestError(
          "Effect position was not frozen before execution",
        );
      const actionId = await this.actionIdentity(occurrence, input);
      const inputHash = await this.identity.hash(input.action);
      const existing = await this.persistence.receipts.findById(actionId);
      if (existing) {
        if (existing.inputHash !== inputHash || existing.mode !== input.mode)
          throw new ConflictError(
            "Effect inputs changed after the durable claim",
          );
        if (existing.status !== "claimed") return existing;
        if (
          existing.mode === "external" &&
          existing.result?.started === true &&
          existing.leaseToken !== token
        )
          throw new ConflictError(
            "An external effect cannot be blindly retried",
          );
        if (existing.leaseToken !== token)
          return this.persistence.receipts.updateById(existing.id, {
            version: existing.version,
            leaseToken: token,
            leaseUntil: occurrence.leaseUntil,
          });
        return existing;
      }
      if (input.runId && input.runId !== occurrence.runId)
        throw new ConflictError(
          "Effect does not belong to the current continuation run",
        );
      if (
        input.action.kind === "notify" &&
        (await this.persistence.receipts.count({
          kind: "action",
          runId: occurrence.runId!,
          recipientChannel: { isNotNull: true },
        })) >= 100
      )
        throw new BadRequestError("Run delivery budget exceeds 100");
      const planned = occurrence.snapshot?.actions[occurrence.cursor];
      if (
        !planned ||
        planned.index !== input.index ||
        planned.row !== input.row
      )
        throw new ConflictError("Effect is not the next planned program step");
      const now = this.dateTime.nowISOString();
      await this.atomic.guarded(
        occurrence.projectId,
        sql`${this.live(occurrence, token)} ${input.action.kind === "notify" ? sql`AND (SELECT COUNT(*) FROM automation_receipts WHERE kind = 'action' AND run_id = ${occurrence.runId} AND recipient_channel IS NOT NULL) < 100` : sql``}`,
        [
          sql`INSERT INTO automation_receipts (id, version, project_id, automation_id, identity, kind, status, occurrence_id, rule_revision, occurred_at, replay_until, lease_token, lease_until, parent_id, run_id, input_hash, mode, action_index, row_index, delivery_key, recipient_user_id, recipient_channel, cursor, roster_complete, created_at, updated_at)
            VALUES (${actionId}, 0, ${occurrence.projectId}, ${occurrence.automationId}, ${actionId}, 'action', 'claimed', ${occurrence.occurrenceId}, ${occurrence.ruleRevision}, ${this.database.timestamp(occurrence.occurredAt)}, ${this.database.timestamp(occurrence.replayUntil)}, ${token}, ${occurrence.leaseUntil ? this.database.timestamp(occurrence.leaseUntil) : null}, ${occurrence.id}, ${input.runId ?? occurrence.runId ?? null}, ${inputHash}, ${input.mode}, ${input.index}, ${input.row ?? null}, ${input.deliveryKey ?? null}, ${input.action.kind === "notify" ? input.action.recipient : null}, ${input.action.kind === "notify" ? input.action.channel : null}, 0, FALSE, ${this.database.timestamp(now)}, ${this.database.timestamp(now)}) ON CONFLICT DO NOTHING`,
        ],
      );
      const receipt = await this.persistence.receipts.getById(actionId);
      if (receipt.inputHash !== inputHash || receipt.mode !== input.mode)
        throw new ConflictError(
          "Effect inputs changed after the durable claim",
        );
      return receipt;
    });
  }

  public async atomicEffect(
    id: string,
    token: string,
    input: Omit<AutomationEffectInput, "mode"> & {
      statements: SQLLike[];
      result: NonNullable<AutomationReceipt["result"]>;
      changedTables?: string[];
    },
  ): Promise<AutomationReceipt> {
    return this.database.primary(async () => {
      const receipt = await this.beginAction(id, token, {
        ...input,
        mode: "atomic",
      });
      if (receipt.status !== "claimed") return receipt;
      const occurrence = await this.lease(id, token);
      await this.authority.check({
        automationId: occurrence.automationId!,
        revision: occurrence.ruleRevision,
        variables: occurrence.snapshot?.variables,
        effect: { index: input.index, action: input.action },
      });
      try {
        await this.atomic.guarded(
          occurrence.projectId,
          sql`${this.live(occurrence, token)} AND EXISTS (SELECT 1 FROM automation_receipts WHERE id = ${receipt.id} AND status = 'claimed' AND lease_token = ${token})`,
          [
            ...input.statements,
            sql`UPDATE automation_receipts SET status = 'committed', result = ${JSON.stringify(this.safeResult(input.result))}, version = version + 1, updated_at = ${this.database.timestamp(this.dateTime.nowISOString())} WHERE id = ${receipt.id}`,
          ],
        );
      } catch (error) {
        const current = await this.persistence.receipts.getById(receipt.id);
        if (current.status === "committed") return current;
        throw error;
      }
      for (const table of new Set([
        ...(input.changedTables ?? []),
        "automation_receipts",
      ]))
        await this.cache.invalidateTable(table);
      return this.persistence.receipts.getById(receipt.id);
    });
  }

  public async externalEffect(
    id: string,
    token: string,
    input: Omit<AutomationEffectInput, "mode"> & {
      perform: () => Promise<NonNullable<AutomationReceipt["result"]>>;
    },
  ): Promise<AutomationReceipt> {
    return this.database.primary(async () => {
      const receipt = await this.beginAction(id, token, {
        ...input,
        mode: "external",
      });
      if (receipt.status !== "claimed") return receipt;
      if (receipt.result?.started === true)
        throw new ConflictError("External effect has already started");
      const occurrence = await this.lease(id, token);
      await this.authority.check({
        automationId: occurrence.automationId!,
        revision: occurrence.ruleRevision,
        variables: occurrence.snapshot?.variables,
        effect: { index: input.index, action: input.action },
      });
      await this.atomic.guarded(
        occurrence.projectId,
        sql`${this.live(occurrence, token)} AND EXISTS (SELECT 1 FROM automation_receipts WHERE id = ${receipt.id} AND status = 'claimed' AND lease_token = ${token} AND version = ${receipt.version})`,
        [
          sql`UPDATE automation_receipts SET result = ${JSON.stringify({ started: true })}, version = version + 1, updated_at = ${this.database.timestamp(this.dateTime.nowISOString())} WHERE id = ${receipt.id}`,
        ],
      );
      try {
        const result = this.safeResult(await input.perform());
        await this.persistence.receipts.updateMany(
          { id: receipt.id, status: "claimed", leaseToken: token },
          { status: "committed", result },
        );
      } catch {
        await this.persistence.receipts.updateMany(
          { id: receipt.id, status: "claimed" },
          { status: "unknown", reason: "External effect outcome is unknown" },
        );
        await this.persistence.receipts.updateMany(
          { id: occurrence.id, status: "claimed" },
          { status: "unknown", leaseToken: null, leaseUntil: null },
        );
        await this.reconcileRun(
          await this.persistence.receipts.getById(occurrence.id),
          "unknown",
        );
        await this.closePending(
          await this.persistence.receipts.getById(occurrence.id),
        );
        await this.evidence.transition(
          occurrence.automationId!,
          "paused",
          "An action outcome is unknown; author review is required",
          true,
        );
      }
      return this.persistence.receipts.getById(receipt.id);
    });
  }

  public async ensureRun(receipt: AutomationReceipt) {
    if (!receipt.snapshot || !receipt.runId || !receipt.automationId)
      throw new AlephaError("Occurrence has no frozen run evidence");
    const rule = await this.persistence.rules.getById(receipt.automationId, {
      force: true,
    });
    const chunk = await this.persistence.receipts.findOne({
      where: {
        projectId: receipt.projectId,
        kind: "chunk",
        runId: receipt.runId,
      },
    });
    const snapshot = chunk?.snapshot ?? receipt.snapshot;
    return this.evidence.persist({
      id: receipt.runId,
      rule: { ...rule, revision: receipt.ruleRevision },
      occurrenceId: receipt.occurrenceId,
      triggeredAt: receipt.occurredAt,
      prepared: {
        snapshot,
        status: receipt.status === "refused" ? "refused" : "queued",
        ...(receipt.reason ? { reason: receipt.reason } : {}),
      },
    });
  }

  protected async reconcileRun(
    occurrence: AutomationReceipt,
    outcome: "unknown" | "refused",
  ) {
    if (!occurrence.runId || !occurrence.snapshot) return;
    let run = await this.ensureRun(occurrence);
    if (!["queued", "running"].includes(run.status)) return;
    const actions = await this.persistence.receipts.findMany({
      where: { parentId: occurrence.id, kind: "action", runId: run.id },
      limit: 350,
    });
    for (const planned of run.snapshot.actions) {
      if (!["pending", "running"].includes(planned.status)) continue;
      const receipts = actions.filter(
        (action) =>
          action.actionIndex === planned.index &&
          action.rowIndex === planned.row,
      );
      const committed = receipts.filter(
        (action) => action.status === "committed",
      );
      const unknown = receipts.find((action) => action.status === "unknown");
      if (!committed.length && !unknown) continue;
      run = await this.evidence.action(run.id, {
        index: planned.index,
        ...(planned.row !== undefined ? { row: planned.row } : {}),
        status: unknown
          ? "unknown"
          : committed.some((action) => action.result?.enqueued === true)
            ? "queued"
            : "succeeded",
        receiptId: (unknown ?? committed[0]).id,
        deliveries: committed.reduce(
          (count, action) => count + (action.result?.enqueued === true ? 1 : 0),
          0,
        ),
        result: unknown
          ? { reason: "External outcome is unknown" }
          : committed[0].result,
      });
    }
    const snapshot = structuredClone(run.snapshot);
    for (const action of snapshot.actions)
      if (["pending", "running"].includes(action.status)) {
        action.status = "skipped";
        action.result = { reason: "Occurrence could not resume" };
      }
    await this.persistence.runs.updateById(run.id, {
      version: run.version,
      snapshot,
      status:
        outcome === "unknown"
          ? "unknown"
          : run.snapshot.counts.executed || run.snapshot.counts.deliveries
            ? "partial"
            : "refused",
      reason: occurrence.reason ?? "Occurrence could not resume",
      finishedAt: this.dateTime.nowISOString(),
    });
  }

  protected async closePending(occurrence: AutomationReceipt): Promise<void> {
    const external = await this.persistence.receipts.findMany({
      where: {
        parentId: occurrence.id,
        kind: "action",
        mode: "external",
        status: "claimed",
      },
      limit: 350,
    });
    const uncertain = external.filter(
      (receipt) => receipt.result?.started === true,
    );
    for (let offset = 0; offset < uncertain.length; offset += 50)
      await this.persistence.receipts.updateMany(
        {
          id: {
            inArray: uncertain
              .slice(offset, offset + 50)
              .map((receipt) => receipt.id),
          },
        },
        {
          status: "unknown",
          reason: "Occurrence stopped with an external action in flight",
        },
      );
    await this.database.batch([
      sql`UPDATE automation_receipts SET status = 'committed', version = version + 1 WHERE kind = 'recipient' AND parent_id IN (SELECT id FROM automation_receipts WHERE parent_id = ${occurrence.id} AND kind = 'roster') AND EXISTS (SELECT 1 FROM automation_receipts AS effect WHERE effect.parent_id = ${occurrence.id} AND effect.kind = 'action' AND effect.status = 'committed' AND effect.delivery_key = automation_receipts.id)`,
      sql`UPDATE automation_receipts SET status = 'refused', reason = 'Occurrence stopped before this work completed', snapshot = NULL, version = version + 1 WHERE status = 'claimed' AND (parent_id = ${occurrence.id} OR parent_id IN (SELECT id FROM automation_receipts WHERE parent_id = ${occurrence.id} AND kind = 'roster'))`,
      sql`UPDATE automation_receipts SET snapshot = NULL, version = version + 1 WHERE id = ${occurrence.id} OR parent_id = ${occurrence.id} OR parent_id IN (SELECT id FROM automation_receipts WHERE parent_id = ${occurrence.id} AND kind = 'roster')`,
    ]);
  }

  public async expireReady(): Promise<number> {
    const now = this.dateTime.nowISOString();
    const rows = await this.persistence.receipts.findMany({
      where: { kind: "occurrence", status: "ready", replayUntil: { lte: now } },
      orderBy: "replayUntil",
      limit: 50,
    });
    let expired = 0;
    for (const row of rows) {
      const changed = await this.persistence.receipts.updateMany(
        { id: row.id, status: "ready", version: row.version },
        {
          status: "refused",
          reason: "Occurrence is outside the 90-day replay horizon",
          leaseUntil: null,
          leaseToken: null,
        },
      );
      if (!changed.length) continue;
      const receipt = await this.persistence.receipts.getById(row.id);
      await this.ensureRun(receipt);
      await this.closePending(receipt);
      expired += 1;
    }
    return expired;
  }

  public async repairTerminals(): Promise<number> {
    const [rows] = await this.database.batch([
      sql`SELECT id FROM automation_receipts AS occurrence WHERE kind = 'occurrence' AND status IN ('refused', 'failed', 'unknown') AND (snapshot IS NOT NULL OR EXISTS (SELECT 1 FROM automation_receipts AS child WHERE child.parent_id = occurrence.id AND child.status = 'claimed')) ORDER BY created_at, id LIMIT 50`,
    ]);
    for (const row of rows) {
      const occurrence = await this.persistence.receipts.getById(
        String(row.id),
      );
      await this.reconcileRun(
        occurrence,
        occurrence.status === "unknown" ? "unknown" : "refused",
      );
      await this.closePending(occurrence);
    }
    return rows.length;
  }

  public async pruneSnapshots(): Promise<number> {
    const cutoff = this.dateTime.now().subtract(30, "days").toISOString();
    const rows = await this.persistence.receipts.findMany({
      where: {
        status: {
          inArray: ["committed", "skipped", "refused", "failed", "unknown"],
        },
        snapshot: { isNotNull: true },
        updatedAt: { lt: cutoff },
      },
      columns: ["id"],
      limit: 50,
    });
    if (!rows.length) return 0;
    return (
      await this.persistence.receipts.updateMany(
        {
          id: { inArray: rows.map((row) => row.id) },
          status: {
            inArray: ["committed", "skipped", "refused", "failed", "unknown"],
          },
        },
        { snapshot: null },
      )
    ).length;
  }

  protected safeResult(
    input: NonNullable<AutomationReceipt["result"]>,
  ): NonNullable<AutomationReceipt["result"]> {
    const fields = [
      "outbox_id",
      "notification_id",
      "quest_id",
      "shortId",
      "folio_id",
      "revision",
      "release_id",
      "changed",
      "skipped",
      "enqueued",
      "delivered",
      "count",
      "late_confirmation",
    ];
    const result: NonNullable<AutomationReceipt["result"]> = {};
    for (const key of fields) {
      const value = input[key];
      if (
        (typeof value === "string" && value.length <= 255) ||
        (typeof value === "number" && Number.isFinite(value)) ||
        typeof value === "boolean"
      )
        result[key] = value;
    }
    return result;
  }

  public async prune(): Promise<number> {
    const now = this.dateTime.nowISOString();
    const rows = await this.persistence.receipts.findMany({
      where: {
        status: {
          inArray: ["committed", "skipped", "refused", "failed", "unknown"],
        },
        replayUntil: { lt: now },
      },
      orderBy: "replayUntil",
      columns: ["id"],
      limit: 50,
    });
    if (!rows.length) return 0;
    return (
      await this.persistence.receipts.deleteMany({
        id: { inArray: rows.map((row) => row.id) },
        status: {
          inArray: ["committed", "skipped", "refused", "failed", "unknown"],
        },
        replayUntil: { lt: now },
      })
    ).length;
  }
}

export interface AutomationEffectInput {
  index: number;
  row?: number;
  deliveryKey?: string;
  runId?: string;
  mode: "atomic" | "external";
  action: AutomationRule["actions"][number];
}
