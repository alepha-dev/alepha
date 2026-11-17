import { $inject, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { BadRequestError, ForbiddenError } from "alepha/server";

import type { Automation } from "../entities/automations.ts";
import { AutomationGraph } from "../schemas/AutomationGraph.ts";
import type { AutomationSourceProvenance } from "../schemas/automationSourceProvenanceSchema.ts";
import type { AutomationTestSource } from "../schemas/automationTestSourceSchema.ts";
import { AutomationVocabulary } from "../schemas/AutomationVocabulary.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";

/**
 * Feature modules project current subjects without invoking business actions.
 * Retired historical payloads refuse instead of silently using current data.
 */
export class AutomationEventSubjects {
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly time = $inject(DateTimeProvider);
  protected readonly handlers = new Map<
    string,
    AutomationEventSubjectHandler
  >();
  public register(key: string, handler: AutomationEventSubjectHandler): void {
    if (this.handlers.has(key))
      throw new AlephaError(`Duplicate event subject '${key}'`);
    this.handlers.set(key, handler);
  }
  public async resolve(
    rule: Automation,
    source: AutomationTestSource,
    node?: string,
  ): Promise<{
    fields: Record<string, unknown>;
    provenance: AutomationSourceProvenance;
  }> {
    // The event of the source a test starts from (#Q3804).
    const origin = new AutomationGraph().source(rule.rule, node);
    if (origin.type === AutomationVocabulary.SCHEDULE)
      throw new BadRequestError("Scheduled rules do not accept event subjects");
    const key = origin.type;
    if (source.kind === "subject") {
      const handler = this.handlers.get(key);
      if (!handler)
        throw new BadRequestError("Event subject adapter is unavailable");
      return {
        fields: {
          ...(await handler(rule.projectId, source.id)),
          ...(key === "release.published"
            ? { publisher_id: rule.authorUserId }
            : {}),
        },
        provenance: {
          mode: "prospective",
          actorUserId: rule.authorUserId,
          key,
          id: String(source.id),
        },
      };
    }
    if (source.kind === "event") {
      const event = await this.persistence.events.getOne({
        where: { id: source.id, projectId: rule.projectId, name: key as never },
      });
      if (
        event.replayUntil <= this.time.nowISOString() ||
        event.payload.omitted.includes("payload_retired")
      )
        throw new BadRequestError(
          "Historical event payload is no longer retained",
        );
      return {
        fields: event.payload.fields,
        provenance: {
          mode: "historical",
          key,
          id: event.id,
          occurredAt: event.occurredAt,
          omitted: event.payload.omitted,
        },
      };
    }
    const run = await this.persistence.runs.getOne({
      where: { id: source.id, projectId: rule.projectId },
    });
    // A run's own source, and no other (#Q3807).
    if (
      !run.snapshot.rule ||
      new AutomationGraph().sourceKey(run.snapshot.rule) !== key ||
      (node !== undefined &&
        run.snapshot.sourceNode !== undefined &&
        run.snapshot.sourceNode !== node)
    )
      throw new ForbiddenError(
        "Historical run does not match this event source",
      );
    if (
      (run.finishedAt ?? run.createdAt) <
      this.time.now().subtract(30, "days").toISOString()
    )
      throw new BadRequestError(
        "Historical run is outside the detail retention period",
      );
    return {
      fields: run.snapshot.inputs,
      provenance: {
        mode: "historical",
        key,
        id: run.id,
        occurredAt: run.triggeredAt,
        omitted: run.snapshot.source?.omitted,
      },
    };
  }
}
export type AutomationEventSubjectHandler = (
  projectId: number,
  id: string | number,
) => Promise<Record<string, unknown>>;
