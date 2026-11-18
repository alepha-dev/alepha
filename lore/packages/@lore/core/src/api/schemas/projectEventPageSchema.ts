import { type Infer, z } from "alepha";

import { projectEventResourceSchema } from "./projectEventResourceSchema.ts";

/**
 * A page of a project's recent events, newest first.
 */
export const projectEventPageSchema = z.object({
  items: z.array(projectEventResourceSchema),
  hasMore: z.boolean(),
});

export type ProjectEventPage = Infer<typeof projectEventPageSchema>;
