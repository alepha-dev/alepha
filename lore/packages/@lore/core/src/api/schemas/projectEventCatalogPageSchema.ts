import { type Infer, z } from "alepha";

import { projectEventCatalogEntrySchema } from "./projectEventCatalogEntrySchema.ts";

/**
 * The events of a project's catalog (#Q3892).
 */
export const projectEventCatalogPageSchema = z.object({
  items: z.array(projectEventCatalogEntrySchema),
});

export type ProjectEventCatalogPage = Infer<
  typeof projectEventCatalogPageSchema
>;
