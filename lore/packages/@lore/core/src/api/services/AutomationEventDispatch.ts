import { $inject } from "alepha";
import { ConflictError, ForbiddenError } from "alepha/server";

import type { AutomationEvent } from "../entities/automationEvents.ts";
import { AutomationTemplateBindings } from "../schemas/AutomationTemplateBindings.ts";
import { AutomationAuthority } from "./AutomationAuthority.ts";
import { AutomationClaims } from "./AutomationClaims.ts";
import { AutomationEvents } from "./AutomationEvents.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";

/**
 * The ingest path only persists facts. The bounded dispatcher reserves ready
 * frames; the evaluator worker owns selectors and ordered effects.
 */
export class AutomationEventDispatch {
  protected readonly events = $inject(AutomationEvents);
  protected readonly claims = $inject(AutomationClaims);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly authority = $inject(AutomationAuthority);
  protected readonly bindings = $inject(AutomationTemplateBindings);
  constructor() {
    this.events.register((event, limit) => this.consume(event, limit));
  }
  protected async consume(event: AutomationEvent, limit: number) {
    const size = Math.min(50, limit);
    if (size < 1) return { done: false, claimed: 0 };
    const rules = await this.persistence.rules.findMany({
      where: {
        projectId: event.projectId,
        enabled: true,
        health: "active",
        requiresApproval: false,
        createdAt: { lte: event.occurredAt },
        ...(event.cursor ? { id: { gt: event.cursor } } : {}),
      },
      orderBy: [{ column: "id", direction: "asc" }],
      limit: size,
    });
    let claimed = 0;
    for (const rule of rules) {
      if (
        rule.rule.trigger.kind !== "event" ||
        rule.rule.trigger.event !== event.name
      )
        continue;
      try {
        const current = await this.authority.check({
          automationId: rule.id,
          revision: rule.revision,
        });
        const filter = rule.rule.trigger.app;
        if (filter !== undefined) {
          const bound = this.bindings.resolve({
            slot: { kind: "text", required: true },
            value: filter,
            fields: {},
            variables: new Map(
              current.variables.map((variable) => [
                variable.key,
                {
                  kind: variable.value.kind,
                  available: true,
                  value: variable.value,
                },
              ]),
            ),
            path: "trigger.app",
          });
          if (bound.value !== event.payload.fields.app) continue;
        }
        await this.claims.reserve({
          automationId: rule.id,
          revision: rule.revision,
          source: { kind: "event", eventId: event.id },
        });
        claimed += 1;
      } catch (error) {
        if (
          !(error instanceof ForbiddenError) &&
          !(error instanceof ConflictError)
        )
          throw error;
      }
    }
    return { done: rules.length < size, cursor: rules.at(-1)?.id, claimed };
  }
}
