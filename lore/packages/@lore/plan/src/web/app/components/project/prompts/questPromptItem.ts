import type { PinnedPromptItem } from "@lore/core/web";

import type { QuestResource } from "../../../../../api/schemas/questResourceSchema.ts";

/**
 * A quest as a pinned prompt's item (#Q4284): its number, and its status
 * derived as `QuestResourceMapper.questStatus` derives it, which decides
 * whether a prompt whose arg does not accept it is offered.
 */
export const questPromptItem = (
  quest: Pick<
    QuestResource,
    "shortId" | "completedAt" | "heldAt" | "acceptedAt" | "shelvedAt"
  >,
): PinnedPromptItem => ({
  type: "quest",
  value: String(quest.shortId),
  status: quest.completedAt
    ? "completed"
    : quest.heldAt
      ? "on_hold"
      : quest.acceptedAt
        ? "in_progress"
        : quest.shelvedAt
          ? "shelved"
          : "todo",
});
