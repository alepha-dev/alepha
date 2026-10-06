import { type Infer, z } from "alepha";

/**
 * The four product surfaces a project composes.
 *
 * - `work` is the project's process: quests, epics, releases, areas, the
 *   board, the roadmap.
 * - `knowledge` is its memory: folios, directories, links, revisions,
 *   attachments.
 * - `apps` is its software: instances, artifacts, quality, and with the
 *   `track` option sigils, analytics, vitals and blights.
 * - `support` is its users: the public request form, the triage inbox,
 *   feedback comments.
 *
 * Everything else is Core and always on: identity, members, settings, and the
 * three surfaces that compose capabilities (dashboard, activity, palette).
 *
 * ⚠️ **The keys are opaque and permanent**, deliberately not named after a UI
 * label. That is the direct lesson of `features.milestones`, which gates a
 * module called Releases and can never be renamed because it is a required
 * key inside a JSON column. A label moves; a key never does. The same rule
 * already binds `sigils.kinds`, whose persisted values are `beacon` (meaning
 * analytics) and `blights` (meaning errors).
 *
 * `mode: "text"` so no `CHECK` constraint is generated and a fifth capability
 * later is a code-only change with no migration. Same reasoning as
 * `epics.status`, `areas.color` and `folioLinks.targetType`.
 *
 * ⚠️ Relative imports only in this file and its neighbours. A module the api
 * and the web both import must not use `@/`: the sigil package's typecheck
 * compiles Lore api files without the alias, which is green in `apps/lore` and
 * red at the root.
 */
export const CAPABILITY_KEYS = [
  "work",
  "knowledge",
  "apps",
  "support",
] as const;

export const capabilityKeySchema = z
  .enum(CAPABILITY_KEYS)
  .meta({ mode: "text" });

export type CapabilityKey = Infer<typeof capabilityKeySchema>;
