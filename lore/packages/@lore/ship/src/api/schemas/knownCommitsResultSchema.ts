import { type Infer, z } from "alepha";

/**
 * Which of the commits a pusher asked about already have a quest set (#E154),
 * in the order asked, with whether each set is complete. The pusher takes the
 * first complete one as the base of its walk.
 */
export const knownCommitsResultSchema = z.object({
  known: z.array(
    z.object({
      sha: z.string(),
      complete: z.boolean(),
    }),
  ),
});

export type KnownCommitsResult = Infer<typeof knownCommitsResultSchema>;
