import { epics } from "../entities/epics.ts";

/**
 * The two epic statuses a person sets by hand: `planned` and `ready`.
 *
 * Extracted from the column rather than restated, so a status renamed on the
 * entity cannot drift out of the one write path that takes it. The other two,
 * `in_progress` and `completed`, are written by the quest requests that make
 * them true (#Q2223), so they are absent here on purpose: an agent reading
 * `epic_set_status`'s schema sees that it cannot ask for them.
 */
export const epicManualStatusSchema = epics.schema.shape.status.extract([
  "planned",
  "ready",
]);
