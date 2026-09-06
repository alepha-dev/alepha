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
 * through `router.path(...)` and applies the project's capability gates. A
 * hand-written page list in the palette would rot the first time a route was
 * renamed — and route names are famously not typecheck-protected here (see
 * `AppRouter.ts`) — while a second gating pass would drift from the sidebar's
 * the first time a capability moved. Reading one computation means the
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
 * ⚠️ **The framework nav model is not coming, and this is the model.** This
 * doc used to defer to `$page` `nav` metadata as the better end state, with
 * the framework's model to be extended first. That quest was shelved on
 * 2026-09-06, and the reason it gives is the reason it will stay shelved:
 * `PageNav` is entirely static and `can()` receives only `{ has }`, so it can
 * express neither per-project state, nor an atom-driven badge, nor an entry
 * that hides itself on runtime rows.
 *
 * `capabilityNav.ts` is the model instead, and it takes TWO inputs. The
 * project's capability set is the first and the only one wired today; the
 * caller's rank permission set is the second, added by Ranks to the SAME
 * computation, so an entry whose permission the rank lacks is filtered once
 * and the palette still cannot disagree. Every entry is a plain data object
 * with room for the permission it opens on, and there must never be a second
 * map.
 *
 * `undefined` (not `[]`) while no project is open.
 */
export const projectNavAtom = $atom({
  name: "lor.project.nav",
  schema: z.array(projectNavEntrySchema).optional(),
});
