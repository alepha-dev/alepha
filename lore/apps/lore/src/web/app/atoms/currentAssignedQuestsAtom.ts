import { $atom, z } from "alepha";

import { questResourceSchema } from "@/api/schemas/questResourceSchema.ts";

export const currentAssignedQuestsAtom = $atom({
  name: "lor.current.assigned_quests",
  schema: z.array(questResourceSchema).optional(),
});
