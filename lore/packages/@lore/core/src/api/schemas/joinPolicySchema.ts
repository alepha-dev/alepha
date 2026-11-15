import { type Infer, z } from "alepha";

/**
 * Who may become a member of a project (epic #E151).
 *
 * - `invite`: only someone an admin invites. Every project starts here.
 * - `open`: anyone signed in may join by themselves, and lands on the rank
 *   keyed `viewer`, which stays inside the Viewer allowlist while the
 *   project is open (`ProjectJoinPolicy`).
 *
 * `mode: "text"` so no `CHECK` constraint is generated: a third policy later
 * is a code-only change with no migration.
 *
 * ⚠️ Absent reads as `invite`, and the fallback lives in
 * `ProjectSecurityService.joinPolicyOf`, never in a column `DEFAULT`. A
 * column DEFAULT on `projects` triggers the D1 table rebuild that
 * cascade-wipes members, quests, releases, folios and feedback. Same reasoning
 * as `roadmapVisibilitySchema`.
 */
export const joinPolicySchema = z
  .enum(["invite", "open"])
  .meta({ mode: "text" });

export type JoinPolicy = Infer<typeof joinPolicySchema>;
