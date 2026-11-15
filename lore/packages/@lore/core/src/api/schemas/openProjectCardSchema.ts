import { type Infer, z } from "alepha";

/**
 * What a stranger sees of an open project before joining it: its card, and
 * nothing behind it (#Q3646). No member count, no content (folio "Open
 * projects: safety contract").
 */
export const openProjectCardSchema = z.object({
  id: z.integer(),
  title: z.text(),
  slug: z.text(),
  /**
   * The project's icon, a file served from the public files route.
   */
  icon: z.uuid().optional(),
});

export type OpenProjectCard = Infer<typeof openProjectCardSchema>;
