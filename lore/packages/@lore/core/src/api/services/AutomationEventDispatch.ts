import { $inject } from "alepha";
import { BadRequestError, ConflictError, ForbiddenError } from "alepha/server";

import type { AutomationEvent } from "../entities/automationEvents.ts";
import { AutomationTemplateBindings } from "../schemas/AutomationTemplateBindings.ts";
import { AutomationTemplateTokens } from "../schemas/AutomationTemplateTokens.ts";
import { AutomationClaims } from "./AutomationClaims.ts";
import { AutomationEvents } from "./AutomationEvents.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";

/**
 * The ingest path only persists facts. The bounded dispatcher reserves ready
 * frames; the evaluator worker owns selectors and ordered effects.
 */
export class AutomationEventDispatch {
  protected readonly tokens = $inject(AutomationTemplateTokens);
  protected readonly bindings = $inject(AutomationTemplateBindings);
  protected readonly events = $inject(AutomationEvents);
  protected readonly claims = $inject(AutomationClaims);
  protected readonly persistence = $inject(AutomationPersistence);
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
        or: [
          { activatedAt: { isNull: true } },
          { activatedAt: { lte: event.occurredAt } },
        ],
        ...(event.cursor ? { id: { gt: event.cursor } } : {}),
      },
      orderBy: [{ column: "id", direction: "asc" }],
      limit: size,
    });
    const filterKeys = [
      ...new Set(
        rules.flatMap((rule) => {
          const key =
            rule.rule.trigger.kind === "event" && rule.rule.trigger.app
              ? this.tokens.whole(rule.rule.trigger.app)
              : undefined;
          return key ? [key] : [];
        }),
      ),
    ];
    const values = filterKeys.length
      ? await this.persistence.variables.findMany({
          where: { projectId: event.projectId, key: { inArray: filterKeys } },
          limit: 50,
        })
      : [];
    const variables = new Map(
      values.map((row) => [
        row.key,
        { kind: row.value.kind, available: true, value: row.value },
      ]),
    );
    let claimed = 0;
    for (const rule of rules) {
      if (
        rule.rule.trigger.kind !== "event" ||
        rule.rule.trigger.event !== event.name
      )
        continue;
      try {
        const filter = rule.rule.trigger.app;
        if (filter !== undefined) {
          let resolved: unknown;
          try {
            resolved = this.bindings.resolve({
              slot: { kind: "text", required: true },
              value: filter,
              fields: {},
              variables,
              path: "trigger.app",
            }).value;
          } catch {
            // The worker records an invalid binding under current authority.
          }
          if (resolved !== undefined && resolved !== event.payload.fields.app)
            continue;
        }
        await this.claims.reserve({
          automationId: rule.id,
          revision: rule.revision,
          source: { kind: "event", eventId: event.id },
        });
        claimed += 1;
      } catch (error) {
        // A refusal for this one rule (it changed, lost its grant or its
        // guard, or no longer listens to this event) skips it. Anything else
        // leaves the event undispatched for the next tick; reserving is
        // idempotent, so rules already reserved are not reserved twice.
        if (
          !(error instanceof ForbiddenError) &&
          !(error instanceof ConflictError) &&
          !(error instanceof BadRequestError)
        )
          throw error;
      }
    }
    return { done: rules.length < size, cursor: rules.at(-1)?.id, claimed };
  }
}
