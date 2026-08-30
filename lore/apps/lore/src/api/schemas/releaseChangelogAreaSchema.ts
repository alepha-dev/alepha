import { type Infer, z } from "alepha";

/**
 * One area's worth of a release changelog, in structured form.
 *
 * The changelog has always been rendered to markdown server-side, but the
 * Releases page needs to draw each entry as a row — quest ref, title and a
 * priority pill — and the markdown lines (`- title [priority]`) carry neither
 * the ref nor a machine-readable priority. Rather than parse the rendered
 * string back apart on the client, `getReleaseChangelog` returns this
 * alongside the markdown: same source query, two projections.
 *
 * `markdown` remains the authoritative, frozen artifact for a closed
 * release. These areas are recomputed on read, so a quest edited after the
 * close will show a different title here than in the downloadable `.md`.
 */
export const releaseChangelogAreaSchema = z.object({
  /**
   * The quest's area, or `Uncategorized` for quests with none — matching
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

export type ReleaseChangelogArea = Infer<typeof releaseChangelogAreaSchema>;
