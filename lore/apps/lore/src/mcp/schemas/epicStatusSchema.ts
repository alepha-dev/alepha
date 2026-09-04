import { epics } from "../../api/entities/epics.ts";

/**
 * Epic lifecycle status. A one-way ratchet since epic #31: `planned` to
 * `active`, `active` to `done`, and `done` is terminal (see
 * `EpicController.setEpicStatus` for the edges and their refusals).
 *
 * Taken from the column. `epics.status` is `mode: "text"` precisely so a
 * fourth status is a code-only change with no migration, which only holds
 * while there is one list to change.
 */
export const epicStatusSchema = epics.schema.shape.status;
