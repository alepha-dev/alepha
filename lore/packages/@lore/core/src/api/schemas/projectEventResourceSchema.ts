import { type Infer, z } from "alepha";

import { projectEventFieldsSchema } from "./projectEventFieldsSchema.ts";

/**
 * One recorded project event, as `event_list` and `lore event list` read it
 * (#Q3895): for "did it fire?".
 */
export const projectEventResourceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  subjectKind: z.string(),
  subjectId: z.string().optional(),
  fields: projectEventFieldsSchema,
  occurredAt: z.datetime(),
});

export type ProjectEventResource = Infer<typeof projectEventResourceSchema>;
