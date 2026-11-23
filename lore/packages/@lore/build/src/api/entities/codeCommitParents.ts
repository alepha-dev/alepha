import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { codeRepositories } from "./codeRepositories.ts";

/**
 * The parent edges of the commit index (#Q4132), one row per parent: what a
 * recursive CTE walks to tell the commits reachable from a revision, the
 * same SQL on D1 and on Postgres (a JSON array would need each dialect's
 * own `json_each`).
 *
 * It is also the index's frontier: a parent no `code_commits` row holds is
 * still to be indexed, which is how the backfill resumes where it stopped.
 * A commit's edges are written before its `code_commits` row, so a crash
 * between them leaves it on the frontier and it is indexed again.
 */
export const codeCommitParents = $entity({
  name: "code_commit_parents",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    repositoryId: db.ref(z.uuid(), () => codeRepositories.cols.id, {
      onDelete: "restrict",
    }),
    sha: z.string().length(40),
    parentSha: z.string().length(40),
    /**
     * 0 for the first parent.
     */
    position: z.integer(),
  }),
  indexes: [
    { columns: ["repositoryId", "sha", "parentSha"], unique: true },
    { columns: ["repositoryId", "parentSha"] },
  ],
});

export type CodeCommitParentRow = Infer<typeof codeCommitParents.schema>;
