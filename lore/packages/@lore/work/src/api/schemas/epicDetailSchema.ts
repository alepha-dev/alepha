import { type Infer, z } from "alepha";

import { epicResourceSchema } from "./epicResourceSchema.ts";

/**
 * An epic with the folios it files, as `epic_get` reports it: read in one
 * round of queries after the epic row rather than one after the other
 * (#Q2636). The folios are described by the `folio` kind Knowledge
 * registers, so each one is a `ResourceRef`'s fields, never a folio row.
 */
export const epicDetailSchema = epicResourceSchema.extend({
  folios: z.array(
    z.object({
      shortId: z.integer(),
      title: z.string(),
      summary: z.string().optional(),
      updatedAt: z.string().optional(),
      pinned: z.boolean().optional(),
    }),
  ),
});

export type EpicDetail = Infer<typeof epicDetailSchema>;
