import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { codeRepositories } from "./codeRepositories.ts";

/**
 * Lore's commit index (#Q4132, folio #F1500 "Lore's commit index"): one row
 * per commit a repository holds, written at push and by the backfill job
 * (`CodeCommitIndex`), on both backends, so path history, the tree's last
 * commits and blame are SQL everywhere. Artifacts has no path filter on its
 * `log`, no diff and no blame.
 *
 * Keyed by `repositoryId` only: a project merge moves `code_repositories`
 * and these follow. ⚠️ `restrict`, like the repository row itself: a D1
 * rebuild of `code_repositories` must never cascade here, and
 * `CodeRepositoryService` deletes the index explicitly before the row.
 *
 * Times are epoch seconds, as git records them.
 */
export const codeCommits = $entity({
  name: "code_commits",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    repositoryId: db.ref(z.uuid(), () => codeRepositories.cols.id, {
      onDelete: "restrict",
    }),
    sha: z.string().length(40),
    /**
     * Null on a root commit.
     */
    firstParent: z.string().length(40).optional(),
    /**
     * Every parent, in git's order, as JSON. The walks read
     * `code_commit_parents`, which holds the same edges as rows.
     */
    parents: z.array(z.string().length(40)),
    treeSha: z.string().length(40),
    authorName: z.string(),
    authorEmail: z.string(),
    authoredAt: z.integer(),
    committerName: z.string(),
    committerEmail: z.string(),
    committedAt: z.integer(),
    subject: z.string(),
    body: z.string(),
  }),
  indexes: [
    { columns: ["repositoryId", "sha"], unique: true },
    { columns: ["repositoryId", "committedAt"] },
  ],
});

export type CodeCommitRow = Infer<typeof codeCommits.schema>;
