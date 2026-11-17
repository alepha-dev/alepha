import { type Infer, z } from "alepha";

import { automationActionSchema } from "./automationActionSchema.ts";
import { automationFilterValueSchema } from "./automationFilterValueSchema.ts";
import { automationGraphNodeIdSchema } from "./automationGraphNodeIdSchema.ts";
import { automationGraphPositionSchema } from "./automationGraphPositionSchema.ts";
import { automationGuardSchema } from "./automationGuardSchema.ts";
import { AutomationVocabulary } from "./AutomationVocabulary.ts";

/**
 * One node of an automation graph (#Q3803). `type` names a vocabulary entry
 * (an event, a selection or metric, an action), or one of the built-in node
 * types `schedule` (a source) and `compare` (a condition). `config` is what
 * the slot of a v1 rule held: an event's filters or a schedule's cron, a
 * selection's filters, a guard, an action without its `kind`.
 *
 * ⚠️ One object with a `kind` tag, not a union: the graph is the
 * `automations.rule` JSON column, and the ORM's model builder takes objects,
 * records and arrays only. The per-kind shape of `config` is checked by the
 * refinement below, in one place.
 */
export const automationGraphNodeSchema = z
  .object({
    id: automationGraphNodeIdSchema,
    kind: z.enum(AutomationVocabulary.KINDS),
    type: z.string().min(1).max(128),
    config: z.record(z.string().max(64), z.any()),
    position: automationGraphPositionSchema.optional(),
    /**
     * A source's own switch (#Q3806). Only a source carries it.
     */
    enabled: z.boolean().optional(),
  })
  .strict()
  .superRefine((node, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({
        code: "custom",
        message: `node '${node.id}': ${message}`,
      });
    if (AutomationVocabulary.RESERVED_KINDS.includes(node.kind as never))
      return issue(
        `the '${node.kind}' kind is reserved: no node type registers it yet`,
      );
    if (node.enabled !== undefined && node.kind !== "source")
      return issue("only a source has its own switch");
    const parsed = (() => {
      if (node.kind === "source")
        return node.type === AutomationVocabulary.SCHEDULE
          ? z
              .object({ cron: z.string().min(9).max(128) })
              .strict()
              .safeParse(node.config)
          : z
              .object({
                app: z.string().max(255).optional(),
                monitor: z.string().max(255).optional(),
                host: z.string().max(255).optional(),
              })
              .strict()
              .safeParse(node.config);
      if (node.kind === "read")
        return z
          .object({
            filters: z
              .record(z.string().max(64), automationFilterValueSchema)
              .refine((value) => Object.keys(value).length <= 16),
          })
          .strict()
          .safeParse(node.config);
      if (node.kind === "condition") {
        if (node.type !== AutomationVocabulary.COMPARE)
          return issue(`unknown condition type '${node.type}'`);
        return automationGuardSchema.safeParse(node.config);
      }
      if (Object.hasOwn(node.config, "kind"))
        return issue("an action's type is its kind");
      return automationActionSchema.safeParse({
        kind: node.type,
        ...node.config,
      });
    })();
    if (parsed && !parsed.success)
      issue(
        parsed.error.issues
          .map((item) =>
            item.path.length
              ? `${item.path.join(".")}: ${item.message}`
              : item.message,
          )
          .join("; "),
      );
  });
export type AutomationGraphNode = Infer<typeof automationGraphNodeSchema>;
