import { type Infer, z } from "alepha";

/**
 * The capabilities a project composes: Lore's three pillars (#E143),
 * Plan, Remember and Ship, and Chat (#E161).
 *
 * - `plan` is the project's process: quests, epics, releases, areas, the
 *   board.
 * - `remember` is its memory: folios, directories, links, revisions,
 *   attachments.
 * - `ship` is its software: instances, artifacts, and with the
 *   `track` option sigils, analytics, vitals and errors.
 * - `chat` is its conversation (#E161): rooms where members talk to each
 *   other and to the agent. Its sidebar row is placed by its own `order`.
 * - `activity` and `reports` (#Q4007) are the Activity page and Reports,
 *   Core until then: a switch each, on for every project by default, that
 *   hides the page and its sidebar entry. Reports also holds the option
 *   `quality`, the coverage CI pushes (#Q4217). With Chat
 *   they form the General group, drawn above the pillars in the wizard and in
 *   Settings (`CapabilityDescriptor.group`).
 *
 * Feedback (the public request form, the triage inbox, feedback comments) was
 * a fourth capability, `support`, until #E143 folded it into Plan as the
 * option `plan.feedback`: one capability per pillar. Build (#E162), the code a
 * project held, was a fourth until #Q4217 removed it: GitHub hosts the code.
 *
 * Everything else is Core and always on: identity, members, settings, and the
 * three surfaces that compose capabilities (dashboard, activity, palette).
 *
 * **A capability key is renamed by a migration, an option key is not.** The
 * keys were declared opaque and permanent until #E143, after
 * `features.milestones`, which gates a module called Releases and could never
 * be renamed because it was a required key inside a JSON column. A capability
 * key is not in JSON: it is `project_capabilities.key`, a text column, and one
 * `UPDATE` moves it (the `work`, `knowledge`, `apps` rows became `plan`,
 * `remember`, `ship` that way, with the audit rows naming them, and every
 * `support` row folded into its project's `plan` row). The old rule
 * still binds OPTION keys, which live in the row's `options` JSON, and
 * `sigils.kinds`, whose persisted values include `beacon` (meaning
 * analytics): renaming one is a data migration in the same deploy, as #E147
 * did for `errors`.
 *
 * `mode: "text"` so no `CHECK` constraint is generated and a new capability
 * later is a code-only change with no migration. Same reasoning as
 * `epics.status`, `areas.color` and `folioLinks.targetType`.
 *
 * ⚠️ Relative imports only in this file and its neighbours. A module the api
 * and the web both import must not use `@/`: the sigil package's typecheck
 * compiles Lore api files without the alias, which is green in `apps/lore` and
 * red at the root.
 */
export const CAPABILITY_KEYS = [
  "plan",
  "remember",
  "ship",
  "chat",
  "prompts",
  "activity",
  "reports",
] as const;

export const capabilityKeySchema = z
  .enum(CAPABILITY_KEYS)
  .meta({ mode: "text" });

export type CapabilityKey = Infer<typeof capabilityKeySchema>;

/**
 * The General group of the wizard and of Settings > General > Capabilities
 * (#Q4007), in the order they are drawn: above the pillars.
 */
export const GENERAL_CAPABILITY_KEYS = [
  "activity",
  "chat",
  "prompts",
  "reports",
] as const;
