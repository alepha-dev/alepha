import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { codeRepositories } from "./codeRepositories.ts";

/**
 * The paths a commit changed (#Q4132), against its first parent (the empty
 * tree for a root commit). A merge keeps only the paths it changed against
 * EVERY parent, as git's history simplification does: a file a merge brought
 * unchanged from its second parent is that parent's history, not the
 * merge's.
 *
 * `renamed` pairs a deleted and an added path with the same blob, `oldPath`
 * naming where it came from. A folder's history is the indexed range
 * `path >= 'dir/' AND path < 'dir0'` (`'0'` follows `'/'`), never a `LIKE`,
 * so the `(repositoryId, path)` index answers it on D1 and on Postgres.
 */
export const codeCommitPaths = $entity({
  name: "code_commit_paths",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    repositoryId: db.ref(z.uuid(), () => codeRepositories.cols.id, {
      onDelete: "restrict",
    }),
    commitSha: z.string().length(40),
    path: z.string(),
    oldPath: z.string().optional(),
    kind: z
      .enum(["added", "modified", "deleted", "renamed"])
      .meta({ mode: "text" }),
    oldBlobSha: z.string().length(40).optional(),
    newBlobSha: z.string().length(40).optional(),
  }),
  indexes: [
    { columns: ["repositoryId", "commitSha", "path"], unique: true },
    { columns: ["repositoryId", "path"] },
  ],
});

export type CodeCommitPathRow = Infer<typeof codeCommitPaths.schema>;
