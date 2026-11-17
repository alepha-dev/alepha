import { type Infer, z } from "alepha";

/**
 * A release as the persona insights name it (#E153); absent means "no
 * release" (current, for a run; unreleased, for a quest).
 */
export const insightReleaseSchema = z.object({
  id: z.integer(),
  tag: z.string().optional(),
  title: z.string(),
  releasedAt: z.datetime().optional(),
});

/**
 * A completed quest that touches a persona, and how it was found: through
 * an epic covering one of its use cases, or a mention of the persona.
 */
export const personaChangeSchema = z.object({
  questNumber: z.integer(),
  title: z.string(),
  completedAt: z.datetime(),
  via: z.enum(["epic", "mention"]),
  epicNumber: z.integer().optional(),
  release: insightReleaseSchema.optional(),
});

/**
 * A persona's scope changes (#E153), computed on read: the quests that
 * touch it since its last run, how many of its use cases to re-verify, and
 * "What's new" per release (every completed quest found by either route).
 */
export const personaChangesSchema = z.object({
  lastRunAt: z.datetime().optional(),
  useCases: z.integer(),
  toReverify: z.integer(),
  changes: z.array(personaChangeSchema),
  releases: z.array(
    z.object({
      release: insightReleaseSchema.optional(),
      quests: z.array(personaChangeSchema),
    }),
  ),
});

/**
 * Where "Open as" leads (#E153): the persona's app copy URL, or why there
 * is none. Lore signs no one in: the demo account and seed are shown to
 * copy.
 */
export const personaAppCopySchema = z.object({
  state: z.enum(["none", "ship_off", "missing", "production", "ready"]),
  app: z.string().optional(),
  env: z.string().optional(),
  url: z.string().optional(),
});

/**
 * One recording of a persona's showcase: the latest run of a use case in a
 * release that holds a video, the file gone when retention removed it.
 */
export const showcaseItemSchema = z.object({
  useCase: z.object({ number: z.integer(), title: z.string() }),
  runId: z.integer(),
  ranAt: z.datetime(),
  stale: z.boolean(),
  file: z
    .object({ fileId: z.uuid(), name: z.string(), mimeType: z.string() })
    .optional(),
  removed: z.boolean(),
  chapters: z.array(z.object({ position: z.integer(), text: z.string() })),
});

export const personaShowcaseSchema = z.array(
  z.object({
    release: insightReleaseSchema.optional(),
    items: z.array(showcaseItemSchema),
  }),
);

export type PersonaChange = Infer<typeof personaChangeSchema>;
export type PersonaChanges = Infer<typeof personaChangesSchema>;
export type PersonaAppCopy = Infer<typeof personaAppCopySchema>;
export type ShowcaseItem = Infer<typeof showcaseItemSchema>;
export type PersonaShowcase = Infer<typeof personaShowcaseSchema>;
export type InsightRelease = Infer<typeof insightReleaseSchema>;
