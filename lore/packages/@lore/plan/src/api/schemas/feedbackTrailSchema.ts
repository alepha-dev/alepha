import { type Infer, z } from "alepha";

/**
 * How many pages and actions a trail keeps, client and server alike: the
 * newest five (#Q4106).
 */
export const FEEDBACK_TRAIL_KEEP = 5;

/**
 * The trail a sigil feedback report carries (#Q4038): the last crashes,
 * paths and actions of the page it was filed from, handed to the popup by
 * the sigil button. Every bound is enforced here, whatever the client sent:
 * like every `source` field it is attacker-controlled, shown as escaped
 * plain text only, never markdown. The caps match `@alepha/lore`'s
 * `SIGIL_FEEDBACK_TRAIL_LIMITS`.
 *
 * `pages` and `actions` accept up to 50, not 5: an older sigil bundle kept
 * 10 and 20, and its report is trimmed to the newest by
 * {@link newestFeedbackTrail}, not refused (#Q4106).
 */
export const feedbackTrailSchema = z.object({
  errors: z
    .array(
      z.object({
        message: z.string().max(500),
        path: z.string().max(500),
        at: z.integer().min(0),
      }),
    )
    .max(5),
  pages: z
    .array(z.object({ path: z.string().max(500), at: z.integer().min(0) }))
    .max(50),
  actions: z
    .array(
      z.object({
        name: z.string().max(100),
        outcome: z.enum(["success", "error"]),
        ms: z.integer().min(0).max(86_400_000),
      }),
    )
    .max(50),
});

export type FeedbackTrail = Infer<typeof feedbackTrailSchema>;

/**
 * The trail as kept: its newest {@link FEEDBACK_TRAIL_KEEP} pages and
 * actions, every list being oldest first.
 */
export const newestFeedbackTrail = (trail: FeedbackTrail): FeedbackTrail => ({
  errors: trail.errors,
  pages: trail.pages.slice(-FEEDBACK_TRAIL_KEEP),
  actions: trail.actions.slice(-FEEDBACK_TRAIL_KEEP),
});
