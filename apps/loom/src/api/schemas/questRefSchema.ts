import { type Infer, z } from "alepha";

/**
 * A Lore quest a branch's commits name as `#Q<n>`.
 *
 * Only `shortId` is always known. The rest comes from the Lore API, which
 * Loom reaches only with `LORE_API_KEY` set and a Lore project on the
 * project.
 */
export const questRefSchema = z.object({
  shortId: z.integer(),
  title: z.string().optional(),
  status: z.string().optional(),
  epic: z
    .object({
      number: z.integer(),
      title: z.string(),
      status: z.string(),
    })
    .optional(),
  /**
   * The quest's page in Lore, when the project names its Lore slug.
   */
  url: z.string().optional(),
});

export type QuestRef = Infer<typeof questRefSchema>;
