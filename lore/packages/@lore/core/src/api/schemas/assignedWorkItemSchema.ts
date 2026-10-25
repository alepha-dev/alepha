import { type Infer, z } from "alepha";

import { prioritySchema } from "../../mcp/schemas/prioritySchema.ts";

/**
 * One of the viewer's open work items in a project, as core shows it: the
 * `quests` of `getProjectById` / `getProjectBySlug`, and the orientation
 * tools' `activeQuests`.
 *
 * Core's own shape, narrower than Work's quest resource, because core reads
 * no quest (#E75, #Q2623): Work fills it through `AssignedWorkRegistry`. The
 * field stays on the project responses because published CLIs read it
 * (`lore project`); the web app reads Work's full resources from
 * `QuestController.getMyActiveQuests` instead.
 */
export const assignedWorkItemSchema = z.object({
  id: z.integer(),
  shortId: z.integer(),
  title: z.string(),
  area: z.string(),
  priority: prioritySchema,
});

export type AssignedWorkItem = Infer<typeof assignedWorkItemSchema>;
