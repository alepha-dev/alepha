import { $atom, z } from "alepha";

/**
 * How many requirements, use cases and personas the open project holds: the
 * counts beside the three Requirements sidebar entries.
 *
 * Written when the project opens (`RequirementsProjectLoader`), then by each
 * list page from the list it already holds, so a create or a delete shows at
 * once. A count the reader may not read, or one that failed, stays absent
 * and its entry shows none. Cleared on project leave.
 */
export const requirementsCountsAtom = $atom({
  name: "lor.current.requirements_counts",
  schema: z.object({
    requirements: z.integer().optional(),
    useCases: z.integer().optional(),
    personas: z.integer().optional(),
  }),
  default: {},
});

export type RequirementsCountKey = "requirements" | "useCases" | "personas";
