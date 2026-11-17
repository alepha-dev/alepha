import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { DbEntityNotFoundError } from "alepha/orm";
import { BadRequestError, ConflictError, ForbiddenError } from "alepha/server";

import type { AutomationReceipt } from "../entities/automationReceipts.ts";
import { AutomationGraph } from "../schemas/AutomationGraph.ts";
import type { AutomationRunSnapshot } from "../schemas/automationRunSnapshotSchema.ts";
import { AutomationVocabulary } from "../schemas/AutomationVocabulary.ts";
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
  protected readonly graphs = $inject(AutomationGraph);

  public async step(
    input: { receiptId: string; token?: string },
    attempt = 1,
  ): Promise<AutomationWorkerNext | undefined> {
    return this.database.primary(async () => {
      let occurrence: AutomationReceipt =
        await this.persistence.receipts.getById(input.receiptId);
      if (occurrence.kind !== "occurrence")
        throw new BadRequestError("Worker requires an occurrence identity");
      if (occurrence.status === "ready") {
        try {
          const rule = await this.persistence.rules.getById(
            occurrence.automationId!,
            {
              force: true,
            },
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
          // One live occurrence per rule: while another is claimed, this one
          // could only lose the claim after paying for its evaluation.
          const holder = await this.persistence.receipts.findOne({
            where: {
              automationId: rule.id,
              kind: "occurrence",
              status: "claimed",
              id: { ne: occurrence.id },
            },
          });
          if (holder) return this.waitFor(occurrence, holder);
          const origin = this.graphs.source(frozen);
          const source = this.claims.sourceOf(
            occurrence.occurrenceId,
            origin.id,
          );
          const evaluation = await this.evaluator.evaluate({
            rule: { ...rule, revision: occurrence.ruleRevision },
            graph: frozen,
            node: origin.id,
            ...(source.kind === "event"
              ? {
                  liveSource: {
                    fields: occurrence.snapshot!.inputs,
                    provenance: {
                      ...occurrence.snapshot!.source,
                      mode: "live" as const,
                      key: origin.type,
                      id: source.eventId,
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
              source.kind === "event"
                ? source
                : {
                    kind: "schedule",
                    scheduledAt: occurrence.occurredAt,
                    node: origin.id,
                  },
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
        if (
          occurrence.snapshot?.rule &&
          this.graphs
            .conditions(occurrence.snapshot.rule)
            .some((node) => node.config.operator === "crossesAbove")
        )
          await this.guards.observe({ occurrenceId: occurrence.id, token });
        for (let count = 0; count < 5; count++) {
          occurrence = await this.claims.lease(occurrence.id, token);
          const planned = occurrence.snapshot!.actions[occurrence.cursor];
          if (!planned) {
            await this.evidence.finish(occurrence.runId!);
            if (
              this.reminders(occurrence.snapshot!) &&
              occurrence.snapshot!.selectionNext
            ) {
              const rule = await this.persistence.rules.getById(
                occurrence.automationId!,
              );
              const evaluation = await this.evaluator.evaluate({
                rule,
                graph: occurrence.snapshot!.rule!,
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
          const step = {
            node: planned.node,
            ...(planned.channel !== undefined
              ? { channel: planned.channel }
              : {}),
            ...(planned.row !== undefined ? { row: planned.row } : {}),
          };
          // A step behind a failed node is not reached, and a failed one is
          // already recorded: the walk goes past both (#Q3804).
          const recorded = (
            await this.persistence.runs.getById(occurrence.runId!)
          ).snapshot.actions.find((action) =>
            this.graphs.sameStep(action, step),
          );
          if (
            recorded &&
            ["not_reached", "failed", "refused"].includes(recorded.status)
          ) {
            await this.claims.pass(occurrence.id, token, step);
            continue;
          }
          const ast = this.graphs.action(occurrence.snapshot!.rule!, step);
          if (ast.kind === "notify" && ast.audience) {
            const progress = await this.rosterWorker.step(
              occurrence,
              token,
              step,
              this.context(occurrence.snapshot!, planned.row),
            );
            if (!progress.done) return { receiptId: occurrence.id, token };
            await this.claims.advance(occurrence.id, token, {
              ...step,
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
            ast.kind === "notify" && this.reminders(occurrence.snapshot!)
              ? `reminder:${context.values.quest_id}:${context.values.reminder_next_at}`
              : undefined;
          const identity = await this.claims.actionIdentity(occurrence, {
            ...step,
            ...(reminderDeliveryKey
              ? { deliveryKey: reminderDeliveryKey }
              : {}),
          });
          let receipt: AutomationReceipt | undefined;
          try {
            receipt = await this.persistence.receipts.findById(identity);
            if (receipt?.status !== "committed") {
              await this.evidence.action(occurrence.runId!, {
                ...step,
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
                      ...(step.row !== undefined
                        ? { rowIndex: step.row }
                        : { rowIndex: { isNull: true } }),
                    },
                    limit: 5,
                  });
                  const settle =
                    this.reminders(occurrence.snapshot!) &&
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
                      ...step,
                      context,
                      ...(reminderDeliveryKey &&
                      rendered.raw.kind === "notify" &&
                      rendered.raw.recipient &&
                      rendered.raw.channel !== undefined
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
                    node: step.node,
                    row: step.row,
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
                  ...step,
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
          } catch (error) {
            // A failed or refused action stops its own branch (#Q3804, the
            // owner's ruling): what is downstream of it is not reached, its
            // siblings still run. A transient fault retries first; a loss
            // of the author's authority stops the whole run (`lease`).
            if (!this.refusal(error) && attempt < 3) throw error;
            await this.claims.lease(occurrence.id, token);
            const reason = (
              error instanceof Error
                ? error.message
                : "Automation action failed"
            ).slice(0, 1024);
            await this.evidence.action(occurrence.runId!, {
              ...step,
              status: this.refusal(error) ? "refused" : "failed",
              result: { reason },
            });
            await this.evidence.unreach(occurrence.runId!, step);
            await this.claims.pass(occurrence.id, token, step);
            continue;
          }
          const skipped =
            receipt.result?.skipped === true ||
            receipt.result?.changed === false;
          await this.evidence.action(occurrence.runId!, {
            ...step,
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
            ...step,
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
        const refusal = this.refusal(error);
        if (!refusal && attempt < 3) throw error;
        const reason = (
          error instanceof Error ? error.message : "Automation worker failed"
        ).slice(0, 1024);
        const planned = latest.snapshot?.actions[latest.cursor];
        if (planned && latest.runId) {
          const run = await this.persistence.runs.getById(latest.runId);
          const current = run.snapshot.actions.find((row) =>
            this.graphs.sameStep(row, planned),
          );
          if (current && ["pending", "running"].includes(current.status)) {
            const committed = await this.persistence.receipts.findById(
              await this.claims.actionIdentity(latest, {
                node: planned.node,
                channel: planned.channel,
                row: planned.row,
                ...(this.reminders(latest.snapshot!)
                  ? {
                      deliveryKey: `reminder:${this.context(latest.snapshot!, planned.row).values.quest_id}:${this.context(latest.snapshot!, planned.row).values.reminder_next_at}`,
                    }
                  : {}),
              }),
            );
            await this.evidence.action(run.id, {
              node: planned.node,
              ...(planned.channel !== undefined
                ? { channel: planned.channel }
                : {}),
              ...(planned.row !== undefined ? { row: planned.row } : {}),
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
  /**
   * Whether an error refuses the step rather than failing it: a domain
   * check said no, as opposed to a fault worth retrying.
   */
  protected refusal(error: unknown): boolean {
    return (
      error instanceof BadRequestError ||
      error instanceof ForbiddenError ||
      error instanceof ConflictError ||
      error instanceof DbEntityNotFoundError
    );
  }

  /**
   * A quest reminders run (`quests.remindersDue`, #Q3626), which follows
   * due-selector cursors and keys each delivery by its due state.
   */
  protected reminders(snapshot: AutomationRunSnapshot): boolean {
    return (
      !!snapshot.rule &&
      this.graphs.read(snapshot.rule)?.type === "quests.remindersDue"
    );
  }

  /**
   * A ready occurrence whose rule is busy with another one waits for it in
   * short delays instead of until its own queue lease lapses and the next
   * dispatch tick requeues it. Its lease is extended over the wait so that
   * recovery does not queue it a second time meanwhile.
   *
   * Bounded by the holder: once the holder's lease has lapsed (it crashed or
   * stalled), this answers nothing and recovery takes both over as before.
   */
  protected async waitFor(
    occurrence: AutomationReceipt,
    holder: AutomationReceipt,
  ): Promise<AutomationWorkerNext | undefined> {
    const now = this.time.nowMillis();
    const until = holder.leaseUntil ? new Date(holder.leaseUntil).getTime() : 0;
    if (until <= now) return;
    const delaySeconds = Math.min(
      30,
      Math.max(1, Math.ceil((until - now) / 1000)),
    );
    const held = await this.persistence.receipts.updateMany(
      { id: occurrence.id, version: occurrence.version, status: "ready" },
      {
        leaseUntil: this.time
          .now()
          .add(delaySeconds + 120, "seconds")
          .toISOString(),
      },
    );
    if (!held.length) return;
    return { receiptId: occurrence.id, delaySeconds };
  }

  public context(
    snapshot: AutomationRunSnapshot,
    row?: number,
  ): AutomationRenderContext {
    const rule = snapshot.rule!;
    const key = this.graphs.sourceKey(rule);
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
      ...(this.graphs.source(rule).type === AutomationVocabulary.SCHEDULE &&
      descriptor.result === "collection"
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

/**
 * What the worker job runs next. `delaySeconds` is a wait for another
 * occurrence of the same rule; otherwise the next step follows at once.
 */
export interface AutomationWorkerNext {
  receiptId: string;
  token?: string;
  delaySeconds?: number;
}
