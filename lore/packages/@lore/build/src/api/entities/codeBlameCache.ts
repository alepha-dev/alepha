import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { codeRepositories } from "./codeRepositories.ts";

/**
 * A file's blame at a commit, kept (#Q4138): computed from the commit index
 * once, answered from here after. Keyed by `(repositoryId, commitSha,
 * path)`, deleted with the repository (`restrict`, like the index), moved by
 * a project merge with it.
 *
 * `status` is `pending` while the walk continues as a job (`state` holds
 * where it stopped), `ready` when every line has its commit, `partial` when
 * the walk stopped at its cap: the lines left read "older than
 * `stoppedAtSha`".
 */
export const codeBlameCache = $entity({
  name: "code_blame_cache",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    updatedAt: db.updatedAt(),
    repositoryId: db.ref(z.uuid(), () => codeRepositories.cols.id, {
      onDelete: "restrict",
    }),
    commitSha: z.string().length(40),
    path: z.string(),
    status: z.enum(["pending", "ready", "partial"]).meta({ mode: "text" }),
    /**
     * Runs of consecutive lines from one commit, 1-based and inclusive.
     */
    ranges: z.array(
      z.object({
        startLine: z.integer(),
        endLine: z.integer(),
        commitSha: z.string().optional(),
        originalPath: z.string().optional(),
      }),
    ),
    stoppedAtSha: z.string().optional(),
    /**
     * How many commits the walk examined so far.
     */
    steps: z.integer(),
    /**
     * The walk's queue while `pending`, as JSON text.
     */
    state: z.string().optional(),
  }),
  indexes: [{ columns: ["repositoryId", "commitSha", "path"], unique: true }],
});

export type CodeBlameCacheRow = Infer<typeof codeBlameCache.schema>;
