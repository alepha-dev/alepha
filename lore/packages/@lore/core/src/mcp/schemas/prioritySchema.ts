import { z } from "alepha";

/**
 * Quest priority levels.
 *
 * The one list: `quests.priority` is declared from it, so MCP cannot refuse a
 * value the app accepts. It is core's vocabulary, not Work's, because core's
 * `project_context` contract names it (#E75): the column points down at it,
 * never the reverse.
 */
export const prioritySchema = z.enum(["optional", "low", "medium", "high"]);
