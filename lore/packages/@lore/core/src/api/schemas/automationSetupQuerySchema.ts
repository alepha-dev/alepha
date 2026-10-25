import { z } from "alepha";

import { automationPageQuerySchema } from "./automationPageQuerySchema.ts";

export const automationSetupQuerySchema = automationPageQuerySchema
  .extend({
    kind: z.enum([
      "member",
      "folio",
      "app",
      "quest",
      "release",
      "epic",
      "feedback",
      "deployment",
    ]),
    /**
     * Narrows the page to labels containing this text, so a picker searches
     * the project instead of paging through it.
     */
    search: z.string().trim().max(100).optional(),
    /**
     * Comma-separated values to resolve to their labels, so a saved rule
     * names its member or folio instead of printing its id.
     */
    ids: z.string().max(2_000).optional(),
  })
  .strict();
