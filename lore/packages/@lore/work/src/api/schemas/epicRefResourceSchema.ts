import type { Infer } from "alepha";

import { epics } from "../entities/epics.ts";

/**
 * An epic reduced to what another list needs in order to NAME one: the
 * `number` a reader recognises, the `title` a tooltip shows, and the
 * `status`.
 *
 * Deliberately NOT `epicResourceSchema`. That one is `epics.schema`
 * extended, so it carries `description`, which is `size: "rich"` and is
 * almost the whole payload: on this project's own database the epic list
 * is 28 rows and 222 KB of JSON, 213 KB of it descriptions (96%). A quests
 * table that only prints `#31`, and a sidebar badge that only counts, must
 * not pay that on every project navigation.
 *
 * Picked from the entity rather than restated, so a column that changes
 * shape changes here too instead of drifting.
 */
export const epicRefResourceSchema = epics.schema.pick({
  id: true,
  number: true,
  title: true,
  status: true,
});

export type EpicRefResource = Infer<typeof epicRefResourceSchema>;
