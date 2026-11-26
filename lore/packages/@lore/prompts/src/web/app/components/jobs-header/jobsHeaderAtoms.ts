import { $atom, z } from "alepha";

/**
 * The jobs this tab started (#Q4514), so the header's jobs button names the
 * one that ends: in memory, gone with the tab, and never another member's
 * or another tab's.
 */
export const jobsStartedHereAtom = $atom({
  name: "lore.prompts.jobsStartedHere",
  schema: z.array(z.string()),
  default: [],
});

/**
 * What the header's jobs button says for a few seconds (#Q4514): a job of
 * this tab queued or ended. `at` tells two announcements of the same job
 * apart, so each one is shown its full time.
 */
export const jobsAnnouncementAtom = $atom({
  name: "lore.prompts.jobsAnnouncement",
  schema: z
    .object({
      jobId: z.string(),
      prompt: z.string().optional(),
      args: z.string().optional(),
      word: z.enum(["queued", "succeeded", "failed", "timed_out", "cancelled"]),
      at: z.number(),
    })
    .optional(),
  default: undefined,
});
