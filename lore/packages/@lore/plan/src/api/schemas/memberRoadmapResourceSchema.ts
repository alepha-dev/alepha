import { type Infer, z } from "alepha";

import { roadmapResourceSchema } from "./roadmapResourceSchema.ts";

/**
 * The roadmap as a signed-in caller reads it: the shared payload, plus the
 * one fact the page cannot derive for itself.
 *
 * ⚠️ **A separate schema on a separate action, deliberately.** The obvious
 * alternative is one action that adds `member` when the caller happens to be
 * one - and a response whose SHAPE depends on who is asking is exactly how a
 * leak survives a green test: every assertion still passes, because the
 * fixture is always the audience the field was meant for. Two actions with
 * two declared shapes cannot do that. `roadmapResourceSchema` stays the
 * narrow one, built under the public audience where trimming is not optional,
 * and this extends it rather than the other way round.
 *
 * The endpoint is reachable by any signed-in user (it also serves a `public`
 * roadmap to a stranger with an account), so this being `false` is a normal
 * answer rather than an error.
 */
export const memberRoadmapResourceSchema = roadmapResourceSchema.extend({
  /**
   * Whether the caller belongs to this project.
   *
   * The page renders links into the release detail and its frozen changelog
   * when it is true, and no links at all when it is false. Both of those
   * destinations are member-gated, so a link offered to a non-member is an
   * invitation to a login screen - which is why this cannot be inferred from
   * "the member endpoint answered".
   */
  member: z.boolean(),
});

export type MemberRoadmapResource = Infer<typeof memberRoadmapResourceSchema>;
