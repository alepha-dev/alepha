import { projects, users } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * A git repository a project holds on Lore (#E162, folio #F1500).
 *
 * The bytes live in the runtime's {@link GitBackend}: Cloudflare Artifacts on
 * the Worker, a bare repository on disk on Node. This row is what Lore knows
 * about it: its slug in the clone URL, its default branch, and the name the
 * backend gave it.
 *
 * ## ⚠️ No cascade on `projectId`
 *
 * Every other project child cascades; this one must not. On D1 a table
 * rebuild of `projects` fires `ON DELETE CASCADE` on its children
 * ("Migration safety on D1", `apps/lore/AGENTS.md`), and a wiped row here
 * would orphan a repository in the backend that nothing names any more.
 * Deleting a project deletes its repositories explicitly
 * (`BuildProjectDeletion`), backend first; a project merge moves them
 * (`BuildProjectMerge`).
 *
 * ## `backendRef` is the backend's own name, set once
 *
 * Derived from the ids at creation (`<projectId>-<repoId>` on Artifacts,
 * `<projectId>/<repoId>` on disk), never from the slug, and never recomputed:
 * a merge moves the row to another project and the repository stays where it
 * is. Artifacts cannot reuse a deleted name for a while (folio #F1527,
 * finding 4), which an id never asks it to.
 */
export const codeRepositories = $entity({
  name: "code_repositories",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    /**
     * ⚠️ `restrict`, spelled out: `db.ref` cascades by default.
     */
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "restrict",
    }),
    /**
     * The name in the clone URL, `/<project>/<slug>.git`: the project slug
     * rule, `[a-z0-9-]`, so it never holds a dot and a `.git` segment is
     * never ambiguous.
     */
    slug: z.string().min(1).max(64),
    defaultBranch: z.string().min(1).max(255).default("main"),
    /**
     * Where the backend keeps it. See the class doc.
     */
    backendRef: z.string().min(1).max(255),
    createdBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    archivedAt: z.datetime().optional(),
  }),
  indexes: [{ columns: ["projectId", "slug"], unique: true }],
});

export type CodeRepository = Infer<typeof codeRepositories.schema>;
