import { $atom, t } from "alepha";
import { chapters } from "../../../api/entities/chapters.ts";

export const currentChaptersAtom = $atom({
  name: "rdm.current.chapters",
  schema: t.optional(
    t.array(
      t.extend(chapters.schema, {
        questCount: t.integer(),
      }),
    ),
  ),
});
