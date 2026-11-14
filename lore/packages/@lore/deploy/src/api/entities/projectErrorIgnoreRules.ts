import { projects, users } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * A project-wide **error ignore rule** — a case-insensitive substring that,
 * when found in an incoming crash's `message`, drops the event at ingestion so
 * it never lands in the Errors inbox.
 *
 * Scoped to the project (not the sigil) so one rule mutes a noisy error
 * across every sigil the project owns — e.g. a `pattern` of `"Unknown tenant"`
 * drops `Unknown tenant: east/1`, `Unknown tenant: testemail`, … from any
 * sigil at once. Matching is a plain case-insensitive `includes` (see
 * {@link ProjectErrorRuleService.matches}); the variable suffix after the prefix is
 * irrelevant.
 *
 * The rule is **future-only**: it filters new ingest, it does NOT retro-purge
 * rows already captured. Existing noise is cleared with the inbox's mass-delete
 * selection instead.
 *
 * Purely additive `CREATE TABLE` — D1-safe. The `cascade` on `projectId`
 * fires only when the parent project is deleted (same chain as the other
 * project-scoped tables); `createdBy` is `set null` so deleting the author
 * keeps the rule intact.
 */
export const projectErrorIgnoreRules = $entity({
  name: "project_error_ignore_rules",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Case-insensitive substring matched against an error's `message`.
     */
    pattern: z.string().min(1).max(200),
    /**
     * The owner who added the rule. NULLABLE + `set null` on delete so a
     * removed account does not cascade-drop the project's ignore rules.
     */
    createdBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    createdAt: db.createdAt(),
  }),
  indexes: [{ columns: ["projectId"] }],
});

export type ProjectErrorIgnoreRule = Infer<
  typeof projectErrorIgnoreRules.schema
>;
export type ProjectErrorIgnoreRuleInsert = Infer<
  typeof projectErrorIgnoreRules.insertSchema
>;
