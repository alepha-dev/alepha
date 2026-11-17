import { $atom, z } from "alepha";

import { automationGraphSchema } from "../../../api/schemas/automationGraphSchema.ts";

/**
 * A preset opened in the canvas (#Q3812): its graph as an unsaved draft,
 * handed from the gallery to `/automations/new?preset=<key>`. Read once by
 * that page; a reload, which loses it, opens the canvas empty.
 */
export const automationDraftAtom = $atom({
  name: "lor.automation.draft",
  schema: z
    .object({
      preset: z.string().max(128),
      title: z.string().max(255),
      rule: automationGraphSchema,
    })
    .optional(),
});
