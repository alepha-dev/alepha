import { z } from "alepha";

/**
 * Epic lifecycle status: `draft`, `ready`, `in_progress`, `completed`
 * (#Q2223), and `shelved` (#E78). The first two are set by hand, both ways
 * (`epic_set_status`); the next two are written by the quest requests that
 * make them true, and `completed` is terminal. `shelved` has its own pair of
 * verbs (`shelveEpic`, `unshelveEpic`) and is NOT done: a dependent epic
 * stays blocked behind it. The rules live on `EpicWorkflowService`, the
 * design in folio #1365.
 *
 * The one list: `epics.status` is declared from it, so a fifth status stays a
 * code-only change (`mode: "text"`, no migration) with one place to edit. It
 * is core's vocabulary, not Work's, because core's `project_context` contract
 * names it (#E75): the column points down at it, never the reverse.
 */
export const epicStatusSchema = z.enum([
  "draft",
  "ready",
  "in_progress",
  "completed",
  "shelved",
]);
