import type { PinnedPromptItem } from "@lore/core/web";

import { QUEST_STATUS_PREFIX } from "../../../../../api/schemas/projectErrorQuestStatus.ts";
import type { ProjectErrorResource } from "../../../../../api/schemas/projectErrorResourceSchema.ts";

/**
 * An error as a pinned prompt's item (#Q4471): its id, and its status as an
 * arg's accepted list names it, `forwarded` standing for `quest:<id>`.
 */
export const errorPromptItem = (
  error: Pick<ProjectErrorResource, "id" | "status">,
): PinnedPromptItem => ({
  type: "error",
  value: String(error.id),
  status: error.status.startsWith(QUEST_STATUS_PREFIX)
    ? "forwarded"
    : error.status,
});
