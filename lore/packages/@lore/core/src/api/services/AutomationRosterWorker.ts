import { $inject } from "alepha";
import { ConflictError } from "alepha/server";

import type { AutomationReceipt } from "../entities/automationReceipts.ts";
import { automationOutboxIdsSchema } from "../schemas/automationOutboxIdsSchema.ts";
import { AutomationAuthority } from "./AutomationAuthority.ts";
import { AutomationCatalog } from "./AutomationCatalog.ts";
import type { AutomationRenderContext } from "./AutomationContextBuilder.ts";
import { AutomationNotifications } from "./AutomationNotifications.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { AutomationRoster } from "./AutomationRoster.ts";
import { AutomationRunEvidence } from "./AutomationRunEvidence.ts";
import { AutomationTemplateRenderer } from "./AutomationTemplateRenderer.ts";
import { CoreAutomationReferences } from "./CoreAutomationReferences.ts";

/**
 * At most five recipient attempts per step. Receipts reconstruct evidence after every crash boundary.
 */
export class AutomationRosterWorker {
  protected readonly renderer = $inject(AutomationTemplateRenderer);
  protected readonly authority = $inject(AutomationAuthority);
  protected readonly roster = $inject(AutomationRoster);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly notifications = $inject(AutomationNotifications);
  protected readonly evidence = $inject(AutomationRunEvidence);
  protected readonly references = $inject(CoreAutomationReferences);
  protected readonly catalog = $inject(AutomationCatalog);
  public async step(
    occurrence: AutomationReceipt,
    token: string,
    index: number,
    context: AutomationRenderContext,
  ): Promise<{ done: boolean; receiptId?: string }> {
    await this.authority.check({
      automationId: occurrence.automationId!,
      revision: occurrence.ruleRevision,
      variables: occurrence.snapshot!.variables,
    });
    const action = occurrence.snapshot!.rule!.actions[index];
    if (action.kind !== "notify" || !action.audience)
      throw new ConflictError("Roster step no longer matches its program");
    const publisherId =
      occurrence.snapshot?.source?.actorUserId ??
      occurrence.snapshot?.inputs.publisher_id;
    if (typeof publisherId !== "string")
      throw new ConflictError("Release publisher identity is unavailable");
    const rendered = this.renderer.render(
      action,
      context,
      occurrence.snapshot!.variables,
    );
    if (rendered.raw.kind !== "notify" || rendered.suppressed)
      throw new ConflictError("Roster notification cannot be rendered");
    const frozen = await this.roster.freeze(occurrence.id, token, {
      index,
      channels: [rendered.raw.channel],
      excludeUserId: publisherId,
    });
    if (frozen.status === "committed")
      return { done: true, receiptId: frozen.id };
    const page = await this.roster.chunk(frozen.id, token);
    if (!["succeeded", "skipped"].includes(page.run.status)) {
      const source = this.catalog
        .entries()
        .find((entry) => entry.key === "release.published")!;
      for (const recipient of page.recipients
        .filter((row) => row.status === "claimed")
        .slice(0, 5)) {
        const reason = await this.references.recipientReason(
          occurrence.projectId,
          recipient.recipientUserId!,
          source,
        );
        if (reason) {
          await this.roster.acknowledge(
            frozen.id,
            token,
            recipient.id,
            undefined,
            reason,
          );
          continue;
        }
        const sent = await this.notifications.enqueue({
          occurrenceId: occurrence.id,
          token,
          index,
          context,
          delivery: {
            recipient: recipient.recipientUserId!,
            channel: recipient.recipientChannel!,
            key: recipient.id,
          },
        });
        await this.roster.acknowledge(
          frozen.id,
          token,
          recipient.id,
          sent.receipt.id,
        );
      }
      const effects = await this.persistence.receipts.findMany({
        where: {
          parentId: occurrence.id,
          runId: page.run.id,
          kind: "action",
          status: "committed",
        },
        limit: 100,
      });
      const ids = automationOutboxIdsSchema.parse(
        effects.flatMap((effect) =>
          typeof effect.result?.outbox_id === "string"
            ? [effect.result.outbox_id]
            : [],
        ),
      );
      const remaining = await this.persistence.receipts.count({
        parentId: frozen.id,
        kind: "recipient",
        position: {
          gte: page.roster.cursor,
          lt: page.roster.cursor + page.recipients.length,
        },
        status: "claimed",
      });
      const latest = await this.persistence.runs.getById(page.run.id);
      const deliveries = ids.length - latest.snapshot.counts.deliveries;
      await this.evidence.action(page.run.id, {
        index,
        status: ids.length ? "queued" : remaining ? "running" : "skipped",
        receiptId: page.chunk.id,
        deliveries,
        aggregate: true,
        result: {
          outbox_ids: JSON.stringify(ids),
          enqueued: ids.length > 0,
          delivered: false,
        },
      });
      if (remaining) return { done: false };
      await this.evidence.finish(page.run.id);
    } else if (
      page.recipients.some((recipient) => recipient.status === "claimed")
    )
      throw new ConflictError(
        "A finished roster chunk still has unfinished recipients",
      );
    const progress = await this.roster.advance(frozen.id, token);
    return progress.hasMore
      ? { done: false }
      : { done: true, receiptId: frozen.id };
  }
}
