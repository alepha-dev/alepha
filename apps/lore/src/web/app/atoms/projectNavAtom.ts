import { $atom, type Infer, z } from "alepha";

/**
 * One destination the palette can offer. Strings only, deliberately: icons are
 * React elements and cannot live in a schema-validated atom, so `kind` carries
 * enough for the palette to pick its own.
 */
const projectNavEntrySchema = z.object({
  /**
   * Already translated — the sidebar resolved it through `tr`.
   */
  label: z.string(),
  /**
   * Already resolved through `router.path(...)`.
   */
  href: z.string(),
  /**
   * `app` is one deployed copy rather than a fixed page. Drives the palette's
   * icon and lets the two be told apart in a group heading.
   */
  kind: z.enum(["page", "app"]),
});

export type ProjectNavEntry = Infer<typeof projectNavEntrySchema>;

/**
 * Every destination the sidebar currently offers for the open project —
 * published by `ProjectView` so the ⌘K palette can offer pages and apps
 * alongside content hits.
 *
 * **Pages are derived from the sidebar's own computed nav, not from a second
 * list.** That is the whole point: the sidebar already resolves each entry
 * through `router.path(...)` and applies the project's `features.*` gates. A
 * hand-written page list in the palette would rot the first time a route was
 * renamed — and route names are famously not typecheck-protected here (see
 * `AppRouter.ts`) — while a second gating pass would drift from the sidebar's
 * the first time a feature flag moved. Reading one computation means the
 * palette cannot disagree with the sidebar about what pages exist.
 *
 * ⚠️ **Instances no longer come from there**, and the exception is deliberate.
 * The sidebar used to expand an Apps group with one child per app, so
 * flattening the nav produced them; #1771 collapsed that to one entry, because
 * a list that grows without bound does not belong in the chrome. The palette
 * still offers them, appended by `ProjectViewNavPublisher` from
 * `currentInstancesAtom` — the atom that IS the data, so there is nothing for
 * it to disagree with.
 *
 * The alternative considered and deferred was moving all of this onto `$page`
 * `nav` metadata so both surfaces derive from the route tree. That is the
 * better end state, but `PageNav` is entirely static and `can()` only receives
 * `{ has }` — it has no way to express per-project feature flags, atom-driven
 * badges, or an Apps group built from runtime rows rather than routes. Doing it
 * properly means extending the framework's nav model first.
 *
 * `undefined` (not `[]`) while no project is open.
 */
export const projectNavAtom = $atom({
  name: "lor.project.nav",
  schema: z.array(projectNavEntrySchema).optional(),
});
