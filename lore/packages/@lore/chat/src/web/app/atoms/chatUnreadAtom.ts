import { $atom, z } from "alepha";

/**
 * The Chat row's badge (#E161, #Q3940): the reader's unread messages in the
 * current project, muted rooms left out, and how many of them mention them.
 */
export const chatUnreadAtom = $atom({
  name: "lore.chat.unread",
  schema: z.object({
    projectId: z.integer(),
    total: z.integer(),
    mentions: z.integer(),
  }),
  default: { projectId: 0, total: 0, mentions: 0 },
});
