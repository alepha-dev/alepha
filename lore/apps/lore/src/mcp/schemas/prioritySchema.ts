import { quests } from "../../api/entities/quests.ts";

/**
 * Quest priority levels.
 *
 * Taken from the column rather than restated: this used to be a second
 * `z.enum([...])` listing the same four values, so adding a fifth priority
 * meant remembering to edit a file in a different directory, and forgetting
 * meant MCP silently refused a value the app accepted.
 */
export const prioritySchema = quests.schema.shape.priority;
