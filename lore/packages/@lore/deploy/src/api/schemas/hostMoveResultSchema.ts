import { type Infer, z } from "alepha";

import { hostResourceSchema } from "./hostResourceSchema.ts";

/**
 * What a move answers (#Q3280): the host in its new home, the loans that
 * stay (a move touches none, so the previous home keeps deploying there if it
 * had one), and whether the server it runs on was bought by somebody who is
 * not a member of the new home, whose cloud account still holds it.
 */
export const hostMoveResultSchema = z.object({
  host: hostResourceSchema,
  loans: z.array(
    z.object({
      id: z.integer(),
      title: z.string(),
      slug: z.string().optional(),
    }),
  ),
  serverElsewhere: z.boolean(),
});

export type HostMoveResult = Infer<typeof hostMoveResultSchema>;
