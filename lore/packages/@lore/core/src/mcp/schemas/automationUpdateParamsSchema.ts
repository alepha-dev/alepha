import { z } from "alepha";

import { automationWriteBodySchema } from "../../api/schemas/automationWriteBodySchema.ts";
import { AutomationGraphParams } from "./AutomationGraphParams.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";

export const automationUpdateParamsSchema = projectParamsSchema
  .extend({
    id: z.uuid(),
    expectedRevision: z.integer().nonnegative(),
    title: automationWriteBodySchema.shape.title.optional(),
    ...AutomationGraphParams.SHAPE,
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.enabled === undefined
        ? value.title !== undefined &&
          (value.nodes !== undefined || value.sources !== undefined)
        : value.title === undefined &&
          value.nodes === undefined &&
          value.sources === undefined,
    {
      message:
        "Supply title with nodes and edges (or sources and actions), or only enabled. Configuration and enable changes require separate revisioned calls.",
    },
  );
