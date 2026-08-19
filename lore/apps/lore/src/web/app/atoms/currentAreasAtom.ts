import { $atom, z } from "alepha";
import { areaResourceSchema } from "@/api/schemas/areaResourceSchema.ts";

/**
 * Every area of the current project, filled by the `project` route
 * loader.
 *
 * This is the ONLY list the pickers read. They used to read
 * `project.areas`, a stored JSON array that `ProjectController.getAreas`
 * unioned with the areas actually found on quests — so an area that
 * existed on a quest but not in the array was visible on the board and
 * yet unselectable and unfilterable. Ten of them, holding 21 quests, in
 * production.
 */
export const currentAreasAtom = $atom({
  name: "lor.current.areas",
  schema: z.array(areaResourceSchema).optional(),
});
