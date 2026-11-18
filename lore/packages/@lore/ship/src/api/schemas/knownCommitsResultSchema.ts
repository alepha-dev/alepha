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
  /**
   * The app the answer is for, echoed when one was asked (#Q3868). A pusher
   * that asked for an app and reads none back is talking to a Lore that
   * answered the whole-history sets, and takes no base from them.
   */
  app: z.string().optional(),
});

export type KnownCommitsResult = Infer<typeof knownCommitsResultSchema>;
