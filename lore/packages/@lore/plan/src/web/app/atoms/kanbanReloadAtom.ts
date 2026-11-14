import { $atom, z } from "alepha";

/**
 * Bumped by the header's create button so the kanban board reloads; the
 * board watches the key.
 */
export const kanbanReloadAtom = $atom({
  name: "lor.kanban.reload",
  schema: z.object({
    key: z.integer(),
  }),
  default: { key: 0 },
});
