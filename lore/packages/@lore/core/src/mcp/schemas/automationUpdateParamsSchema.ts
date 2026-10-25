import { z } from "alepha";

import { automationWriteBodySchema } from "../../api/schemas/automationWriteBodySchema.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";

export const automationUpdateParamsSchema = projectParamsSchema
  .extend({
    id: z.uuid(),
    expectedRevision: z.integer().nonnegative(),
    title: automationWriteBodySchema.shape.title.optional(),
    rule: automationWriteBodySchema.shape.rule.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.enabled === undefined
        ? value.title !== undefined && value.rule !== undefined
        : value.title === undefined && value.rule === undefined,
    {
      message:
        "Supply title and rule together, or only enabled. Configuration and enable changes require separate revisioned calls.",
    },
  );
