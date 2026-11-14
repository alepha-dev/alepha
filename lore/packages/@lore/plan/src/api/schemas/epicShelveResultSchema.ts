import { z } from "alepha";

import { epicResourceSchema } from "./epicResourceSchema.ts";

/**
 * What `shelveEpic` and `unshelveEpic` answer (#E78): the epic as it now
 * stands, and how many of its quests the request moved, which is the number
 * the confirm promised and the agent reports back.
 */
export const epicShelveResultSchema = epicResourceSchema.extend({
  movedQuests: z.integer(),
});
