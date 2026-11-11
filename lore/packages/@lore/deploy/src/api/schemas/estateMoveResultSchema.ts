import { type Infer, z } from "alepha";

import { estateResourceSchema } from "./estateResourceSchema.ts";

/**
 * What a move answers (#Q3280): the estate in its new home, the loans that
 * stay (a move touches none, so the previous home keeps deploying there if it
 * had one), and whether the server it runs on was bought by somebody who is
 * not a member of the new home, whose cloud account still holds it.
 */
export const estateMoveResultSchema = z.object({
  estate: estateResourceSchema,
  loans: z.array(
    z.object({
      id: z.integer(),
      title: z.string(),
      slug: z.string().optional(),
    }),
  ),
  serverElsewhere: z.boolean(),
});

export type EstateMoveResult = Infer<typeof estateMoveResultSchema>;
