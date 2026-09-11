import { type Infer, z } from "alepha";

import { feedback } from "../entities/feedback.ts";
import { quests } from "../entities/quests.ts";
import { questStatusSchema } from "./questResourceSchema.ts";

/**
 * Quest stub linked from a feedback item. Mirrors the subset of `quests` fields the
 * feedback status page (reporter-facing) and inbox drawer (owner-facing) need
 * to render quest progression — full quest details live behind their own
 * endpoint.
 */
export const feedbackLinkedQuestSchema = quests.schema
  .pick({ id: true, shortId: true, title: true, priority: true, area: true })
  .extend({
    /**
     * Three values, not five: the mapper derives this from `acceptedAt` /
     * `completedAt` and reads neither `shelvedAt` nor `heldAt`, so a
     * shelved or held linked quest reads as whichever of the three it
     * last was.
     *
     * `on_hold` is excluded deliberately rather than by omission. This is the
     * reporter-facing surface, and an outside reporter reading "Held" is
     * being told that their request is blocked on something internal
     * without being told what — which is worse than seeing the quest as
     * still in progress, because it invites a question nobody here can
     * answer for them.
     */
    status: questStatusSchema
      .exclude(["shelved", "on_hold"])
      .meta({ mode: "text" }),
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
 * `quests.feedbackId`). Status is derived per-quest: a fresh quest is `todo`
 * until accepted, `in_progress` while in progress, `completed` when finished.
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
