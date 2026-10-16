import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { DbEntityNotFoundError } from "alepha/orm";
import { BadRequestError, ConflictError, ForbiddenError } from "alepha/server";

import type { AutomationReceipt } from "../entities/automationReceipts.ts";
import type { AutomationRunSnapshot } from "../schemas/automationRunSnapshotSchema.ts";
import { AutomationCatalog } from "./AutomationCatalog.ts";
import { AutomationClaims } from "./AutomationClaims.ts";
import type { AutomationRenderContext } from "./AutomationContextBuilder.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationDomainActions } from "./AutomationDomainActions.ts";
import { AutomationEvaluator } from "./AutomationEvaluator.ts";
import { AutomationGuards } from "./AutomationGuards.ts";
import { AutomationNotifications } from "./AutomationNotifications.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { AutomationRosterWorker } from "./AutomationRosterWorker.ts";
import { AutomationRunEvidence } from "./AutomationRunEvidence.ts";
import { AutomationSelections } from "./AutomationSelections.ts";
import { AutomationTemplateRenderer } from "./AutomationTemplateRenderer.ts";

/**
 * One job performs at most five ordered steps. The lease, original contexts,
 * cursor and operation receipts, rather than a job acknowledgement, own progress.
 */
export class AutomationWorker {
  protected readonly rosterWorker = $inject(AutomationRosterWorker);
  protected readonly database = $inject(AutomationDatabase);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly evaluator = $inject(AutomationEvaluator);
  protected readonly claims = $inject(AutomationClaims);
  protected readonly evidence = $inject(AutomationRunEvidence);
  protected readonly guards = $inject(AutomationGuards);
  protected readonly domain = $inject(AutomationDomainActions);
  protected readonly notifications = $inject(AutomationNotifications);
  protected readonly selections = $inject(AutomationSelections);
  protected readonly renderer = $inject(AutomationTemplateRenderer);
  protected readonly catalog = $inject(AutomationCatalog);
  protected readonly time = $inject(DateTimeProvider);

  public async step(
    input: { receiptId: string; token?: string },
    attempt = 1,
  ): Promise<{ receiptId: string; token: string } | undefined> {
    return this.database.primary(async () => {
      let occurrence: AutomationReceipt =
        await this.persistence.receipts.getById(input.receiptId);
      if (occurrence.kind !== "occurrence")
        throw new BadRequestError("Worker requires an occurrence identity");
      if (occurrence.status === "ready") {
        try {
          const rule = await this.persistence.rules.getById(
            occurrence.automationId!,
            { force: true },
          );
          if (
            occurrence.replayUntil <= this.time.nowISOString() ||
            !!rule.deletedAt ||
            !rule.enabled ||
            rule.revision !== occurrence.ruleRevision ||
            rule.requiresApproval ||
            rule.health !== "active"
          ) {
            await this.claims.refuseReady(
              occurrence.id,
              "Automation changed or is unavailable before evaluation",
            );
            return;
          }
          const frozen = occurrence.snapshot?.rule;
          if (!frozen) return;
          const evaluation = await this.evaluator.evaluate({
            rule: { ...rule, rule: frozen, revision: occurrence.ruleRevision },
            ...(frozen.trigger.kind === "event"
              ? {
                  liveSource: {
                    fields: occurrence.snapshot!.inputs,
                    provenance: {
                      ...occurrence.snapshot!.source,
                      mode: "live" as const,
                      key: frozen.trigger.event,
                      id: occurrence.occurrenceId.slice(6),
                      occurredAt: occurrence.occurredAt,
                    },
                  },
                }
              : {}),
          });
          const active = await this.claims.claim({
            automationId: rule.id,
            revision: occurrence.ruleRevision,
            source:
              frozen.trigger.kind === "event"
                ? { kind: "event", eventId: occurrence.occurrenceId.slice(6) }
                : { kind: "schedule", scheduledAt: occurrence.occurredAt },
            prepared: evaluation.prepared!,
          });
          if (active.state !== "claimed" || !active.receipt?.leaseToken) return;
          occurrence = active.receipt;
        } catch (error) {
          if (
            !(error instanceof BadRequestError) &&
            !(error instanceof ForbiddenError) &&
            !(error instanceof ConflictError)
          )
            throw error;
          await this.claims.refuseReady(occurrence.id, error.message);
          return;
        }
      } else if (
        occurrence.status !== "claimed" ||
        !input.token ||
        input.token !== occurrence.leaseToken
      )
        return;
      const token = occurrence.leaseToken!;
      try {
        occurrence = await this.claims.renew(occurrence.id, token);
        await this.claims.ensureRun(occurrence);
        if (occurrence.snapshot?.rule?.guard?.operator === "crossesAbove")
          await this.guards.observe({ occurrenceId: occurrence.id, token });
        for (let count = 0; count < 5; count++) {
          occurrence = await this.claims.lease(occurrence.id, token);
          const planned = occurrence.snapshot!.actions[occurrence.cursor];
          if (!planned) {
            await this.evidence.finish(occurrence.runId!);
            if (
              occurrence.snapshot!.rule!.compatibility === "quest-reminders" &&
              occurrence.snapshot!.selectionNext
            ) {
              const rule = await this.persistence.rules.getById(
                occurrence.automationId!,
              );
              const evaluation = await this.evaluator.evaluate({
                rule: { ...rule, rule: occurrence.snapshot!.rule! },
                evaluatedAt: occurrence.snapshot!.evaluatedAt,
                cursor: occurrence.snapshot!.selectionNext,
              });
              if (evaluation.refusal)
                throw new BadRequestError(evaluation.refusal);
              await this.claims.continueReminderSelection(
                occurrence.id,
                token,
                evaluation.prepared!.snapshot,
              );
              return { receiptId: occurrence.id, token };
            }
            await this.claims.complete(occurrence.id, token);
            return;
          }
          const ast = occurrence.snapshot!.rule!.actions[planned.index];
          if (ast.kind === "notify" && ast.audience) {
            const progress = await this.rosterWorker.step(
              occurrence,
              token,
              planned.index,
              this.context(occurrence.snapshot!, planned.row),
            );
            if (!progress.done) return { receiptId: occurrence.id, token };
            await this.claims.advance(occurrence.id, token, {
              index: planned.index,
              row: planned.row,
              receiptId: progress.receiptId!,
            });
            continue;
          }

          if (
            ast.kind === "notify" &&
            (await this.persistence.receipts.count({
              parentId: occurrence.id,
              kind: "action",
              runId: occurrence.runId!,
              recipientChannel: { isNotNull: true },
            })) >= 100
          )
            occurrence = await this.claims.continueRun(occurrence.id, token);
          const context = this.context(occurrence.snapshot!, planned.row);
          const rendered = this.renderer.render(
            ast,
            context,
            occurrence.snapshot!.variables,
          );
          const reminderDeliveryKey =
            ast.kind === "notify" &&
            occurrence.snapshot!.rule!.compatibility === "quest-reminders"
              ? `reminder:${context.values.quest_id}:${context.values.reminder_next_at}`
              : undefined;
          const identity = await this.claims.actionIdentity(occurrence, {
            ...planned,
            ...(reminderDeliveryKey
              ? { deliveryKey: reminderDeliveryKey }
              : {}),
          });
          let receipt: AutomationReceipt | undefined =
            await this.persistence.receipts.findById(identity);
          if (receipt?.status !== "committed") {
            await this.evidence.action(occurrence.runId!, {
              index: planned.index,
              row: planned.row,
              status: "running",
            });
            try {
              if (ast.kind === "notify") {
                const earlier = await this.persistence.receipts.findMany({
                  where: {
                    parentId: occurrence.id,
                    kind: "action",
                    status: "committed",
                    runId: occurrence.runId!,
                    ...(planned.row !== undefined
                      ? { rowIndex: planned.row }
                      : { rowIndex: { isNull: true } }),
                  },
                  limit: 5,
                });
                const settle =
                  occurrence.snapshot!.rule!.select?.key ===
                    "quests.remindersDue" &&
                  !earlier.some((row) => row.result?.enqueued === true)
                    ? this.selections.settlement(
                        "quests.remindersDue",
                        occurrence.projectId,
                        context,
                        occurrence.snapshot!.evaluatedAt!,
                      )
                    : undefined;
                receipt = (
                  await this.notifications.enqueue({
                    occurrenceId: occurrence.id,
                    token,
                    index: planned.index,
                    row: planned.row,
                    context,
                    ...(reminderDeliveryKey &&
                    rendered.raw.kind === "notify" &&
                    rendered.raw.recipient
                      ? {
                          delivery: {
                            recipient: rendered.raw.recipient,
                            channel: rendered.raw.channel,
                            key: reminderDeliveryKey,
                          },
                        }
                      : {}),
                    ...(settle ? { settlement: settle } : {}),
                  })
                ).receipt;
              } else
                receipt = await this.domain.execute({
                  occurrenceId: occurrence.id,
                  token,
                  index: planned.index,
                  row: planned.row,
                  context,
                });
            } catch (error) {
              // A controller hook can fail after its native root committed.
              // Recover that receipt before deciding that the action failed.
              receipt = await this.persistence.receipts.findById(identity);
              if (receipt?.status !== "committed") throw error;
            }
          }
          if (!receipt || receipt.status !== "committed") {
            if (receipt?.status === "unknown") {
              await this.evidence.action(occurrence.runId!, {
                index: planned.index,
                row: planned.row,
                status: "unknown",
                receiptId: receipt.id,
              });
              await this.claims.stop(
                occurrence.id,
                token,
                "unknown",
                "Action outcome is unknown",
              );
              return;
            }
            throw new BadRequestError(
              "Action did not produce a committed receipt",
            );
          }
          const skipped =
            receipt.result?.skipped === true ||
            receipt.result?.changed === false;
          await this.evidence.action(occurrence.runId!, {
            index: planned.index,
            row: planned.row,
            status: skipped
              ? "skipped"
              : receipt.result?.enqueued === true
                ? "queued"
                : "succeeded",
            receiptId: receipt.id,
            result: receipt.result,
            deliveries: receipt.result?.enqueued === true ? 1 : 0,
          });
          if (rendered.truncated)
            await this.evidence.truncated(occurrence.runId!);
          await this.claims.advance(occurrence.id, token, {
            index: planned.index,
            row: planned.row,
            receiptId: receipt.id,
          });
        }
        await this.claims.renew(occurrence.id, token);
        return { receiptId: occurrence.id, token };
      } catch (error) {
        const latest = await this.persistence.receipts.getById(occurrence.id);
        if (
          latest.status !== "claimed" ||
          latest.leaseToken !== token ||
          !latest.leaseUntil ||
          latest.leaseUntil <= this.time.nowISOString()
        )
          return;
        const refusal =
          error instanceof BadRequestError ||
          error instanceof ForbiddenError ||
          error instanceof ConflictError ||
          error instanceof DbEntityNotFoundError;
        if (!refusal && attempt < 3) throw error;
        const reason = (
          error instanceof Error ? error.message : "Automation worker failed"
        ).slice(0, 1024);
        const planned = latest.snapshot?.actions[latest.cursor];
        if (planned && latest.runId) {
          const run = await this.persistence.runs.getById(latest.runId);
          const current = run.snapshot.actions.find(
            (row) => row.index === planned.index && row.row === planned.row,
          );
          if (current && ["pending", "running"].includes(current.status)) {
            const committed = await this.persistence.receipts.findById(
              await this.claims.actionIdentity(latest, {
                ...planned,
                ...(latest.snapshot?.rule?.compatibility === "quest-reminders"
                  ? {
                      deliveryKey: `reminder:${this.context(latest.snapshot!, planned.row).values.quest_id}:${this.context(latest.snapshot!, planned.row).values.reminder_next_at}`,
                    }
                  : {}),
              }),
            );
            await this.evidence.action(run.id, {
              index: planned.index,
              row: planned.row,
              status:
                committed?.status === "committed"
                  ? committed.result?.skipped === true ||
                    committed.result?.changed === false
                    ? "skipped"
                    : committed.result?.enqueued === true
                      ? "queued"
                      : "succeeded"
                  : refusal
                    ? "refused"
                    : "failed",
              ...(committed?.status === "committed"
                ? {
                    receiptId: committed.id,
                    result: committed.result,
                    deliveries: committed.result?.enqueued === true ? 1 : 0,
                  }
                : { result: { reason } }),
            });
          }
        }
        await this.claims.stop(
          latest.id,
          token,
          refusal ? "refused" : "failed",
          reason,
        );
      }
    });
  }
  public context(
    snapshot: AutomationRunSnapshot,
    row?: number,
  ): AutomationRenderContext {
    const rule = snapshot.rule!;
    const key =
      rule.trigger.kind === "event" ? rule.trigger.event : rule.select!.key;
    const descriptor = this.catalog
      .entries()
      .find((entry) => entry.key === key);
    if (!descriptor)
      throw new BadRequestError("Frozen source vocabulary is unavailable");
    const values = row !== undefined ? snapshot.selected[row] : snapshot.inputs;
    if (!values)
      throw new BadRequestError("Frozen selected row is unavailable");
    return {
      descriptor,
      values,
      ...(rule.select?.kind === "collection"
        ? {
            collection: {
              items: snapshot.selected,
              total: snapshot.counts.total,
              totalIsExact: snapshot.counts.totalIsExact,
              hasMore: snapshot.counts.hasMore,
              truncated: snapshot.counts.truncated,
            },
          }
        : {}),
    };
  }
}
