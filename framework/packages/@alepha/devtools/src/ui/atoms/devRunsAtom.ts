import { $atom, z } from "alepha";
import { inspectorRunSchema } from "alepha/inspector";

import { worktreeStateSchema } from "../../server/schemas/worktreeStateSchema.ts";

/**
 * The last run list the devtools server returned, with the git state of their
 * worktrees. Written by `useRuns`, read by anything that needs the selected
 * run itself (its `cwd`, to tell the app's own stack frames from the rest).
 */
export const devRunsAtom = $atom({
  name: "devtools.runs",
  schema: z.object({
    runs: z.array(inspectorRunSchema),
    worktrees: z.record(z.text(), worktreeStateSchema),
  }),
  default: { runs: [], worktrees: {} },
});
