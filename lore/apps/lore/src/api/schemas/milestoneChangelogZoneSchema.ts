import { type Infer, z } from "alepha";

/**
 * One zone's worth of a milestone changelog, in structured form.
 *
 * The changelog has always been rendered to markdown server-side, but the
 * Milestones page needs to draw each entry as a row — quest ref, title and a
 * priority pill — and the markdown lines (`- title [priority]`) carry neither
 * the ref nor a machine-readable priority. Rather than parse the rendered
 * string back apart on the client, `getMilestoneChangelog` returns this
 * alongside the markdown: same source query, two projections.
 *
 * `markdown` remains the authoritative, frozen artifact for a closed
 * milestone. These zones are recomputed on read, so a quest edited after the
 * close will show a different title here than in the downloadable `.md`.
 */
export const milestoneChangelogZoneSchema = z.object({
  /**
   * The quest's zone, or `Uncategorized` for quests with none — matching
   * what the markdown renderer groups under.
   */
  name: z.string(),
  questCount: z.integer(),
  quests: z.array(
    z.object({
      /**
       * Per-project quest reference, rendered as `#42`. This is the whole
       * reason the structured form exists — the markdown drops it.
       */
      shortId: z.integer(),
      title: z.string(),
      priority: z.enum(["optional", "low", "medium", "high"]),
    }),
  ),
});

export type MilestoneChangelogZone = Infer<typeof milestoneChangelogZoneSchema>;
