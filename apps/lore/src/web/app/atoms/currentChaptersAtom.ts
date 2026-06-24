import { $atom, z } from "alepha";
import { chapters } from "@/api/entities/chapters.ts";

export const currentChaptersAtom = $atom({
  name: "lor.current.chapters",
  schema: z
    .array(
      chapters.schema.extend({
        questCount: z.integer(),
      }),
    )
    .optional(),
});
