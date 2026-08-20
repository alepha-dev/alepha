import { type Infer, z } from "alepha";
import { feedback } from "../entities/feedback.ts";

/**
 * Quest stub linked from a feedback item. Mirrors the subset of `quests` fields the
 * feedback status page (reporter-facing) and inbox drawer (owner-facing) need
 * to render quest progression — full quest details live behind their own
 * endpoint.
 */
export const feedbackLinkedQuestSchema = z.object({
  id: z.integer(),
  shortId: z.integer(),
  title: z.string(),
  status: z.enum(["new", "accepted", "completed"]).meta({ mode: "text" }),
  priority: z.string(),
  area: z.string(),
  acceptedAt: z.datetime().optional(),
  completedAt: z.datetime().optional(),
});

export type FeedbackLinkedQuest = Infer<typeof feedbackLinkedQuestSchema>;

/**
 * Feedback entity exposed to the API.
 *
 * Adds `reporter` (resolved from `reporterUserId`), `attachmentUrls` so the
 * inbox UI can render attachments without a second round-trip per file, and
 * `linkedQuests` — the quests spawned from this feedback (via
 * `quests.feedbackId`). Status is derived per-quest: a fresh quest is `new`
 * until accepted, `accepted` while in progress, `completed` when finished.
 */
export const feedbackResourceSchema = feedback.schema.extend({
  reporter: z
    .object({
      id: z.uuid(),
      username: z.string().optional(),
      name: z.string().optional(),
      picture: z.string().optional(),
    })
    .optional(),
  attachmentUrls: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        url: z.string(),
        mimeType: z.string(),
        size: z.number(),
      }),
    )
    .optional(),
  linkedQuests: z.array(feedbackLinkedQuestSchema).optional(),
});

export type FeedbackResource = Infer<typeof feedbackResourceSchema>;
