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
 * `epic` and `release` are LIVE: `epicProgress` and `releaseProgress` accept
 * them, and both declare `boards: ["project"]`, so a card of either kind is
 * always inside one project.
 *
 * ⚠️ They are also the two kinds whose picker is not a list of things the
 * reader owns but one row of another table, which is what made them the only
 * kinds the Add-card panel forgot. Anything added to this union needs a
 * branch in FOUR places, and three of them are silent when it is missing:
 * `DashboardScopeService.assertWellFormed` and `narrow` (loud - they throw),
 * `DashboardCatalogue.initialScope` (falls through to another kind),
 * `DashboardCatalogue.canSave` (refuses on the wrong grounds), and
 * `DashboardScopeStep` (renders an empty step).
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
   * `kind: "epic"` - one epic, for `epicProgress`. Its row ID, not its
   * per-project `number`: the card resolves the number for the link.
   */
  epicId: z.integer().optional(),
  /**
   * `kind: "release"` - one release, for `releaseProgress`. Its row ID, not
   * its tag: the card resolves the tag for the link.
   */
  releaseId: z.integer().optional(),
});

export type DashboardScope = Infer<typeof dashboardScopeSchema>;

export type DashboardScopeKind = DashboardScope["kind"];
