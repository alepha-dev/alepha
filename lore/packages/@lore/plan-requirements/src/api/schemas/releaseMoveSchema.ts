import { type Infer, z } from "alepha";

/**
 * One epic a target release change would move (#E153), and why the change
 * asks first when it does.
 */
export const releaseMoveSchema = z.object({
  epicId: z.integer(),
  epicNumber: z.integer(),
  epicTitle: z.string(),
  fromReleaseId: z.integer().optional(),
  /**
   * The epic also covers these other requirements, which would move too.
   */
  alsoCovers: z.array(z.integer()),
});

export type ReleaseMove = Infer<typeof releaseMoveSchema>;
