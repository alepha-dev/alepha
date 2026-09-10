import { epics } from "../../api/entities/epics.ts";

/**
 * Epic lifecycle status: `planned`, `ready`, `in_progress`, `completed`
 * (#Q2223). The first two are set by hand, both ways (`epic_set_status`);
 * the other two are written by the quest requests that make them true, and
 * `completed` is terminal. The rules live on `EpicWorkflowService`.
 *
 * Taken from the column. `epics.status` is `mode: "text"` precisely so a
 * fifth status is a code-only change with no migration, which only holds
 * while there is one list to change.
 */
export const epicStatusSchema = epics.schema.shape.status;
