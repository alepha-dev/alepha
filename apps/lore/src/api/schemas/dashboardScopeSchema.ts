import { type Infer, z } from "alepha";

/**
 * What a dashboard card is pointed at.
 *
 * Conceptually a tagged union — `all | projects[] | apps[] | epic |
 * release` — because the tiles need genuinely different shapes: unique
 * visitors takes one app, open blights takes a list of apps that may span
 * projects, active quests takes one project. Each metric declares the kinds
 * it accepts (`DashboardMetricCatalog`), so a card whose scope kind its
 * metric does not accept is invalid by construction.
 *
 * ⚠️ Encoded as a **tagged object** rather than a `z.discriminatedUnion`
 * because this schema is also the `dashboard_cards.scope` column, and the
 * ORM's model builder maps `ZodObject` / `ZodRecord` / `ZodArray` to a JSON
 * column and throws `Unsupported schema` on anything else. The union
 * invariant — exactly the payload its `kind` calls for, and nothing else —
 * is enforced by `DashboardScopeService.assertWellFormed`, in one place,
 * with a spec.
 *
 * `epic` and `release` exist for the deferred epic-progress / release-burn
 * tiles. No v1 metric accepts them yet; they are here so the stored shape does
 * not have to change when one does.
 */
export const dashboardScopeSchema = z.object({
  kind: z
    .enum(["all", "projects", "apps", "epic", "release"])
    .meta({ mode: "text" }),
  /**
   * `kind: "projects"` — one or more project ids the caller is a member of.
   */
  projectIds: z.array(z.integer()).max(50).optional(),
  /**
   * `kind: "apps"` — one or more sigil ids. **Not implicitly single-project**:
   * an app list may span every project the caller belongs to, which is what
   * makes it the hardest picker in the set.
   */
  sigilIds: z.array(z.uuid()).max(50).optional(),
  /**
   * `kind: "epic"` — reserved for the deferred epic-progress tile.
   */
  epicId: z.integer().optional(),
  /**
   * `kind: "release"` — reserved for the deferred release-burn tile.
   */
  releaseId: z.integer().optional(),
});

export type DashboardScope = Infer<typeof dashboardScopeSchema>;

export type DashboardScopeKind = DashboardScope["kind"];
