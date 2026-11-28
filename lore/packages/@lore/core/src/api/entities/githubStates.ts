import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";
import { users } from "./users.ts";

/**
 * A `state` Lore sent to GitHub and expects back once (#Q4360, #Q4362).
 *
 * A round trip through GitHub (the App manifest flow, a project's App
 * install) carries Lore's `state` there and back. The row binds it to who
 * started it, for what, and until when; `GitHubStateService.claim` sets
 * `usedAt` in the write's WHERE, so a replayed callback finds it used and
 * attaches nothing. The value GitHub carries is the row's id and its HMAC,
 * so a forged one never reaches the table.
 */
export const githubStates = $entity({
  name: "github_states",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    purpose: z.enum(["manifest", "install"]).meta({ mode: "text" }),
    userId: db.ref(z.uuid(), () => users.cols.id, { onDelete: "cascade" }),
    projectId: db.ref(z.integer().optional(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    expiresAt: z.string(),
    usedAt: z.string().optional(),
    createdAt: db.createdAt(),
  }),
  indexes: [{ columns: ["expiresAt"] }],
});

export type GitHubState = Infer<typeof githubStates.schema>;
