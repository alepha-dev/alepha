import { useProjectAiContext } from "@lore/core/web";

import type { EpicResource } from "../../../../../api/schemas/epicResourceSchema.ts";
import type { QuestResource } from "../../../../../api/schemas/questResourceSchema.ts";

/**
 * Tells an assistant turn sent from an epic's page which epic it is
 * (#Q3972): its reference, title, status, progress, description and its
 * quests by reference, title and status. "What does this epic lack?" then
 * needs no number typed.
 */
export const useEpicAiContext = (
  epic: EpicResource,
  quests: QuestResource[] | null,
): void => {
  useProjectAiContext("epic", {
    kind: "epic",
    reference: `#E${epic.number}`,
    number: epic.number,
    title: epic.title,
    status: epic.status,
    progress: epic.progress,
    description: epic.description,
    quests: (quests ?? []).slice(0, 40).map((it) => ({
      reference: `#Q${it.shortId}`,
      title: it.title,
      status: it.metadata.status,
    })),
  });
};
