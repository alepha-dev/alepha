import { type Infer, z } from "alepha";

/**
 * Narrows `event_list` (#Q3895): one event name, one subject id, a page.
 */
export const projectEventListQuerySchema = z.object({
  name: z.string().max(64).optional(),
  subject: z.string().max(255).optional(),
  limit: z.integer().min(1).max(100).optional(),
  offset: z.integer().min(0).max(10_000).optional(),
});

export type ProjectEventListQuery = Infer<typeof projectEventListQuerySchema>;
