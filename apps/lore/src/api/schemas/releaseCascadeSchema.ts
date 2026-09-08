import { type Infer, z } from "alepha";

/**
 * What setting a release on an epic did to the epic's quests.
 *
 * Reported rather than silent, because every one of the three numbers is a
 * thing the caller would want to know and none of them is visible from the
 * epic row that comes back beside it: the quests moved without anyone asking
 * for them by name, and the ones that could not move stayed where they were
 * while the call still succeeded.
 */
export const releaseCascadeSchema = z.object({
  /**
   * Quests whose `releaseId` actually changed. Zero is the ordinary case for
   * an epic that was already coherent with its quests.
   */
  moved: z.integer(),
  /**
   * Quests that did NOT follow, because they name a release of their own.
   *
   * The cascade is a default rather than an override (see
   * `ReleaseCascadeService`), so a quest whose epic ships in `0.28.0` while
   * the quest ships in `1.0.0` keeps saying so. Counted rather than left
   * silent: the epic and that quest now disagree, and the caller is entitled
   * to know the disagreement was theirs and not the cascade's.
   */
  kept: z.integer(),
  /**
   * Quests the cascade could not move, each with the refusal.
   *
   * A published release refuses being written into and being taken out of,
   * per quest, so a single quest that already shipped stops following its
   * epic while every other quest follows. Partial application is the only
   * option available - D1 has no transaction here - so what matters is that
   * it is never reported as a clean success.
   */
  refused: z.array(
    z.object({
      shortId: z.integer(),
      reason: z.string(),
    }),
  ),
});

export type ReleaseCascade = Infer<typeof releaseCascadeSchema>;
