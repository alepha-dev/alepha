import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { sql } from "alepha/orm";
import { BadRequestError, ConflictError } from "alepha/server";

import type { AutomationReceipt } from "../entities/automationReceipts.ts";
import { AutomationAtomic } from "./AutomationAtomic.ts";
import { AutomationChannels } from "./AutomationChannels.ts";
import { AutomationClaims } from "./AutomationClaims.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationIdentity } from "./AutomationIdentity.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { AutomationProjectSecurity } from "./AutomationProjectSecurity.ts";
import { AutomationRunEvidence } from "./AutomationRunEvidence.ts";

/**
 * Freeze the full current membership roster in one atomic INSERT SELECT.
 * Delivery still checks each current recipient's source access/preferences.
 * Each action/row gets its own cursor and bounded 100-delivery chunks.
 */
export class AutomationRoster {
  protected readonly claims = $inject(AutomationClaims);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly database = $inject(AutomationDatabase);
  protected readonly atomic = $inject(AutomationAtomic);
  protected readonly identity = $inject(AutomationIdentity);
  protected readonly channels = $inject(AutomationChannels);
  protected readonly security = $inject(AutomationProjectSecurity);
  protected readonly evidence = $inject(AutomationRunEvidence);
  protected readonly dateTime = $inject(DateTimeProvider);

  public async freeze(
    id: string,
    token: string,
    input: {
      index: number;
      row?: number;
      channels: string[];
      excludeUserId?: string;
    },
  ): Promise<AutomationReceipt> {
    return this.database.primary(async () => {
      const occurrence = await this.claims.lease(id, token);
      const action = occurrence.snapshot?.rule?.actions[input.index];
      if (
        !action ||
        action.kind !== "notify" ||
        !occurrence.snapshot?.actions.some(
          (planned) =>
            planned.index === input.index && planned.row === input.row,
        )
      )
        throw new BadRequestError(
          "Roster must belong to a planned notification action",
        );
      const rosterId = await this.identity.hash([
        "roster",
        occurrence.id,
        input.index,
        input.row ?? null,
      ]);
      const existing = await this.persistence.receipts.findById(rosterId);
      if (existing) return existing;
      const channels = [...new Set(input.channels)];
      const available = await this.channels.all(occurrence.projectId);
      if (
        !channels.length ||
        channels.length > 100 ||
        channels.some(
          (channel) =>
            !available.some(
              (entry) =>
                entry.key === channel && entry.available && entry.addressable,
            ),
        )
      )
        throw new BadRequestError(
          "Roster channels must name configured addressable transports",
        );
      const project = await this.security.projects.getById(
        occurrence.projectId,
      );
      if (!project.organizationId)
        throw new BadRequestError("Project has no membership organization");
      const now = this.dateTime.nowISOString();
      try {
        await this.atomic.guarded(
          occurrence.projectId,
          sql`${this.claims.live(occurrence, token)} AND NOT EXISTS (SELECT 1 FROM automation_receipts WHERE id = ${rosterId})`,
          [
            sql`INSERT INTO automation_receipts (id, version, project_id, automation_id, identity, kind, status, occurrence_id, rule_revision, occurred_at, replay_until, parent_id, action_index, row_index, cursor, roster_complete, created_at, updated_at)
              VALUES (${rosterId}, 0, ${occurrence.projectId}, ${occurrence.automationId}, ${rosterId}, 'roster', 'claimed', ${occurrence.occurrenceId}, ${occurrence.ruleRevision}, ${this.database.timestamp(occurrence.occurredAt)}, ${this.database.timestamp(occurrence.replayUntil)}, ${occurrence.id}, ${input.index}, ${input.row ?? null}, 0, FALSE, ${this.database.timestamp(now)}, ${this.database.timestamp(now)})`,
            sql`INSERT INTO automation_receipts (id, version, project_id, automation_id, identity, kind, status, occurrence_id, rule_revision, occurred_at, replay_until, parent_id, recipient_user_id, recipient_channel, position, cursor, roster_complete, created_at, updated_at)
              SELECT (${rosterId} || ':' || members.user_id || ':' || channels.channel), 0, ${occurrence.projectId}, ${occurrence.automationId}, (${rosterId} || ':' || members.user_id || ':' || channels.channel), 'recipient', 'claimed', ${occurrence.occurrenceId}, ${occurrence.ruleRevision}, ${this.database.timestamp(occurrence.occurredAt)}, ${this.database.timestamp(occurrence.replayUntil)}, ${rosterId}, members.user_id, channels.channel, ROW_NUMBER() OVER (ORDER BY members.user_id, channels.channel) - 1, 0, FALSE, ${this.database.timestamp(now)}, ${this.database.timestamp(now)}
              FROM organization_members AS members JOIN users ON users.id = members.user_id
              CROSS JOIN (${sql.join(
                channels.map((channel) => sql`SELECT ${channel} AS channel`),
                sql` UNION ALL `,
              )}) AS channels
              WHERE members.organization_id = ${project.organizationId} AND users.enabled = TRUE ${input.excludeUserId ? sql`AND members.user_id <> ${input.excludeUserId}` : sql``}`,
            sql`UPDATE automation_receipts SET roster_complete = TRUE, version = version + 1 WHERE id = ${rosterId}`,
          ],
        );
      } catch (error) {
        const raced = await this.persistence.receipts.findById(rosterId);
        if (raced) return raced;
        throw error;
      }
      return this.persistence.receipts.getById(rosterId);
    });
  }

  public async page(rosterId: string, token: string) {
    return this.database.primary(async () => {
      const roster = await this.persistence.receipts.getById(rosterId);
      if (
        roster.kind !== "roster" ||
        !roster.parentId ||
        !roster.rosterComplete
      )
        throw new BadRequestError("Recipient roster is not frozen");
      const occurrence = await this.claims.lease(roster.parentId, token);
      const rows = await this.persistence.receipts.findMany({
        where: {
          parentId: roster.id,
          kind: "recipient",
          position: { gte: roster.cursor },
        },
        orderBy: "position",
        limit: 101,
      });
      return {
        roster,
        occurrence,
        recipients: rows.slice(0, 100),
        hasMore: rows.length > 100,
        total: await this.persistence.receipts.count({
          parentId: roster.id,
          kind: "recipient",
        }),
      };
    });
  }

  public async chunk(rosterId: string, token: string) {
    return this.database.primary(async () => {
      const page = await this.page(rosterId, token);
      const occurrence = page.occurrence;
      if (!occurrence.snapshot)
        throw new ConflictError("Occurrence has no frozen context");
      const id = await this.identity.hash([
        "chunk",
        rosterId,
        page.roster.cursor,
      ]);
      let receipt = await this.persistence.receipts.findById(id);
      if (!receipt) {
        const snapshot = structuredClone(occurrence.snapshot);
        snapshot.counts.executed = 0;
        snapshot.counts.deliveries = 0;
        snapshot.actions = snapshot.actions
          .filter(
            (action) =>
              action.index === page.roster.actionIndex &&
              action.row === page.roster.rowIndex,
          )
          .map((action) => ({
            index: action.index,
            ...(action.row !== undefined ? { row: action.row } : {}),
            status: "pending",
            result: {},
          }));
        const now = this.dateTime.nowISOString();
        const runId = crypto.randomUUID();
        await this.atomic.guarded(
          occurrence.projectId,
          this.claims.live(occurrence, token),
          [
            sql`INSERT INTO automation_receipts (id, version, project_id, automation_id, identity, kind, status, occurrence_id, rule_revision, occurred_at, replay_until, parent_id, run_id, snapshot, position, cursor, roster_complete, created_at, updated_at)
              VALUES (${id}, 0, ${occurrence.projectId}, ${occurrence.automationId}, ${id}, 'chunk', 'claimed', ${occurrence.occurrenceId}, ${occurrence.ruleRevision}, ${this.database.timestamp(occurrence.occurredAt)}, ${this.database.timestamp(occurrence.replayUntil)}, ${rosterId}, ${runId}, ${JSON.stringify(snapshot)}, ${page.roster.cursor}, 0, FALSE, ${this.database.timestamp(now)}, ${this.database.timestamp(now)}) ON CONFLICT DO NOTHING`,
          ],
        );
        receipt = await this.persistence.receipts.getById(id);
      }
      if (occurrence.runId && occurrence.runId !== receipt.runId)
        await this.evidence.continueInAnotherRun(occurrence.runId);
      await this.persistence.receipts.updateMany(
        { id: occurrence.id, leaseToken: token },
        { runId: receipt.runId },
      );
      const rule = await this.persistence.rules.getById(
        occurrence.automationId!,
      );
      const run = await this.evidence.persist({
        id: receipt.runId,
        rule: { ...rule, revision: occurrence.ruleRevision },
        occurrenceId: occurrence.occurrenceId,
        triggeredAt: occurrence.occurredAt,
        prepared: { snapshot: receipt.snapshot!, status: "queued" },
      });
      return { ...page, chunk: receipt, run };
    });
  }

  public async acknowledge(
    rosterId: string,
    token: string,
    recipientId: string,
    effectId?: string,
    reason?: string,
  ): Promise<void> {
    const page = await this.page(rosterId, token);
    const recipient = page.recipients.find((row) => row.id === recipientId);
    if (!recipient)
      throw new BadRequestError(
        "Recipient is outside the current bounded chunk",
      );
    const condition = effectId
      ? sql`EXISTS (SELECT 1 FROM automation_receipts WHERE id = ${effectId} AND parent_id = ${page.occurrence.id} AND kind = 'action' AND status = 'committed' AND delivery_key = ${recipientId})`
      : sql`TRUE`;
    await this.atomic.guarded(
      page.occurrence.projectId,
      sql`${this.claims.live(page.occurrence, token)} AND ${condition}`,
      [
        sql`UPDATE automation_receipts SET status = ${effectId ? "committed" : "skipped"}, reason = ${reason?.slice(0, 1024) ?? null}, version = version + 1, updated_at = ${this.database.timestamp(this.dateTime.nowISOString())} WHERE id = ${recipientId} AND parent_id = ${rosterId}`,
      ],
    );
  }

  public async advance(
    rosterId: string,
    token: string,
  ): Promise<{ hasMore: boolean; cursor: number }> {
    const page = await this.page(rosterId, token);
    const next = page.recipients.length
      ? page.recipients[page.recipients.length - 1].position! + 1
      : page.roster.cursor;
    const chunkId = await this.identity.hash([
      "chunk",
      rosterId,
      page.roster.cursor,
    ]);
    const now = this.dateTime.nowISOString();
    await this.atomic.guarded(
      page.occurrence.projectId,
      sql`${this.claims.live(page.occurrence, token)} AND EXISTS (SELECT 1 FROM automation_receipts AS chunk JOIN automation_runs AS run ON run.id = chunk.run_id WHERE chunk.id = ${chunkId} AND run.status IN ('succeeded', 'skipped')) AND NOT EXISTS (SELECT 1 FROM automation_receipts WHERE parent_id = ${rosterId} AND kind = 'recipient' AND position >= ${page.roster.cursor} AND position < ${next} AND status = 'claimed')`,
      [
        sql`UPDATE automation_receipts SET status = 'committed', snapshot = NULL, version = version + 1, updated_at = ${this.database.timestamp(now)} WHERE id = ${chunkId}`,
        sql`UPDATE automation_receipts SET cursor = ${next}, status = ${page.hasMore ? "claimed" : "committed"}, version = version + 1, updated_at = ${this.database.timestamp(now)} WHERE id = ${rosterId} AND cursor = ${page.roster.cursor}`,
      ],
    );
    return { hasMore: page.hasMore, cursor: next };
  }
}
