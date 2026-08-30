import { type Infer, z } from "alepha";

/**
 * One heading's worth of a release changelog, in structured form.
 *
 * The changelog is rendered to markdown server-side, but the release page
 * draws each entry as a row — quest ref, title and a priority pill — and the
 * markdown lines (`- title [priority]`) carry neither the ref nor a
 * machine-readable priority. Rather than parse the rendered string back apart
 * on the client, `getReleaseChangelog` returns this alongside the markdown:
 * one source, two projections.
 *
 * ⚠️ **Both projections freeze together on a published release.** They used
 * not to: the markdown was frozen at close and this was recomputed on read, so
 * a quest edited afterwards showed a different title in the rows than in the
 * downloadable `.md`. That was defensible while a milestone was a passive
 * record of a time window. A released release is immutable, so the frozen copy
 * of this lives on `releases.changelogGroups` and neither projection moves
 * again.
 *
 * Grouped by EPIC first, then by area for the quests belonging to no epic in
 * this release: an epic is a headline, a loose quest is a line item.
 */
export const releaseChangelogGroupSchema = z.object({
  /**
   * `epic` for an attached epic's own section, `area` for the loose quests
   * gathered under the area they were done in.
   */
  kind: z.enum(["epic", "area"]).meta({ mode: "text" }),
  /**
   * The epic's title, or the area's name — `Uncategorized` for a loose quest
   * with no area, matching what the markdown renderer groups under.
   */
  name: z.string(),
  /**
   * The epic's per-project number, so the page can render `#12`. Absent for
   * an area group, which has no ref.
   */
  ref: z.integer().optional(),
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

export type ReleaseChangelogGroup = Infer<typeof releaseChangelogGroupSchema>;
