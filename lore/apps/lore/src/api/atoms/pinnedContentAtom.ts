import { $atom, type Infer, z } from "alepha";

/**
 * Token budget for pinned folio bodies surfaced in `project_context`.
 * Held as an atom so ops/tests can override via
 * `alepha.store.set(pinnedContentAtom, { ... })` without touching code.
 *
 * The cap counts characters (not tokens). The renderer drops the
 * oldest-updated pinned folios first when the sum exceeds the cap, and
 * marks the response with `pinnedFoliosTruncated: true`. A single folio
 * larger than the cap is still included with a `truncatedAt` marker so
 * the agent sees a useful prefix.
 */
export const pinnedContentAtom = $atom({
  name: "lore.folio.pinnedContent",
  description:
    "Cap for total characters of pinned folio bodies in project_context.",
  schema: z.object({
    /** Max characters across all pinned folios surfaced in project_context. */
    maxChars: z.integer().min(256).default(8192),
  }),
  default: {
    maxChars: 8192,
  },
  serverOnly: true,
});

export type PinnedContentOptions = Infer<typeof pinnedContentAtom.schema>;
