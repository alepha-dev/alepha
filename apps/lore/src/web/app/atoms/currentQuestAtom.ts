import { $atom, t } from "alepha";
import { questResourceSchema } from "@/api/schemas/questResourceSchema.ts";

export const currentQuestAtom = $atom({
  name: "lor.current.quest",
  schema: t.optional(questResourceSchema),
});
