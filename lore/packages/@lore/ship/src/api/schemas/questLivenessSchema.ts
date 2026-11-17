import { type Infer, z } from "alepha";

import { liveQuestInstanceSchema } from "./liveQuestInstanceSchema.ts";

/**
 * Where one quest is live (#E154): the copies running its commits, and
 * whether every copy Lore deployed has a known, complete set. Without
 * `settled`, an empty list means "not known to be live", never "not live".
 */
export const questLivenessSchema = z.object({
  instances: z.array(liveQuestInstanceSchema),
  settled: z.boolean(),
});

export type QuestLiveness = Infer<typeof questLivenessSchema>;
