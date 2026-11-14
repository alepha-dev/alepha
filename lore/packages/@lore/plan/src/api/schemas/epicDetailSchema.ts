import { type Infer, z } from "alepha";

import { epicResourceSchema } from "./epicResourceSchema.ts";
import { epicReviewsResultSchema } from "./epicReviewsResultSchema.ts";

/**
 * An epic with the folios it files and its reviews, as `epic_get` reports it: read in one
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
  /**
   * The epic's reviews and its open-question count (#E121), read beside
   * the rollup and the folios so `epic_get` pays no extra round trip.
   */
  reviews: epicReviewsResultSchema,
});

export type EpicDetail = Infer<typeof epicDetailSchema>;
