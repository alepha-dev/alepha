import type { Infer } from "alepha";
import { z } from "alepha";

/**
 * Whether a project title can be taken, as the creation wizard asks it while
 * the name is typed.
 *
 * Answered by the same check `createProject` enforces, so the wizard's tick
 * and the create call cannot disagree. `slug` is the URL the title derives,
 * empty for a title that transliterates to nothing (it gets `project-<id>`
 * on create, which is always free).
 */
export const projectNameAvailabilitySchema = z.object({
  slug: z.text(),
  available: z.boolean(),
  /**
   * Why an unavailable name is refused: another project holds the slug, or
   * the router owns that first segment.
   */
  reason: z.enum(["taken", "reserved"]).optional(),
});

export type ProjectNameAvailability = Infer<
  typeof projectNameAvailabilitySchema
>;
