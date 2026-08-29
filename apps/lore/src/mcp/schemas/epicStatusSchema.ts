import { epics } from "../../api/entities/epics.ts";

/**
 * Epic lifecycle status. All transitions between the three are legal —
 * there is no forbidden edge (see `EpicController.setEpicStatus`).
 *
 * Taken from the column. `epics.status` is `mode: "text"` precisely so a
 * fourth status is a code-only change with no migration, which only holds
 * while there is one list to change.
 */
export const epicStatusSchema = epics.schema.shape.status;
