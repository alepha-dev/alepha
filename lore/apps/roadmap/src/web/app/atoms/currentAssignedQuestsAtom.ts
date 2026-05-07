import { $atom, t } from "alepha";
import { questResourceSchema } from "@/api/schemas/questResourceSchema.ts";

export const currentAssignedQuestsAtom = $atom({
  name: "rdm.current.assigned_quests",
  schema: t.optional(t.array(questResourceSchema)),
});
