import { useProjectAiContext } from "@lore/core/web";

import type { QuestResource } from "../../../../../api/schemas/questResourceSchema.ts";

/**
 * Tells an assistant turn sent while a quest is open which quest it is
 * (#Q3972): its reference, title, status, area, priority, tags, description
 * and objectives. "What is left on this quest?" then needs no number typed.
 */
export const useQuestAiContext = (quest: QuestResource): void => {
  useProjectAiContext("quest", {
    kind: "quest",
    reference: `#Q${quest.shortId}`,
    shortId: quest.shortId,
    title: quest.title,
    status: quest.metadata.status,
    area: quest.area,
    priority: quest.priority,
    tags: quest.tags,
    description: quest.description,
    objectives: (quest.objectives ?? []).map((it) => ({
      title: it.title,
      completed: it.completed,
    })),
  });
};
