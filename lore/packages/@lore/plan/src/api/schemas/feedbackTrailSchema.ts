import { type Infer, z } from "alepha";

/**
 * The trail a sigil feedback report carries (#Q4038): the last crashes,
 * paths and actions of the page it was filed from, handed to the popup by
 * the sigil button. Every bound is enforced here, whatever the client sent:
 * like every `source` field it is attacker-controlled, shown as escaped
 * plain text only, never markdown. The caps match `@alepha/lore`'s
 * `SIGIL_FEEDBACK_TRAIL_LIMITS`.
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
    .max(10),
  actions: z
    .array(
      z.object({
        name: z.string().max(100),
        outcome: z.enum(["success", "error"]),
        ms: z.integer().min(0).max(86_400_000),
      }),
    )
    .max(20),
});

export type FeedbackTrail = Infer<typeof feedbackTrailSchema>;
