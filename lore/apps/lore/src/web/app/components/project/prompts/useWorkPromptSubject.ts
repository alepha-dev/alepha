import {
  type AgentPromptItemSubject,
  type AgentPromptProjectSubject,
  useAgentPromptSubject,
} from "@lore/core/web";

import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import type { FeedbackResource } from "@/api/schemas/feedbackResourceSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

/**
 * Work's prompt subjects, over core's kind-blind `useAgentPromptSubject`
 * (#E75, #Q2624): an epic, a quest, a feedback item, and the feedback inbox
 * and quest list as whole surfaces.
 */
export const useWorkPromptSubject = () => {
  const subject = useAgentPromptSubject();

  return {
    forEpic: (epic: EpicResource): AgentPromptItemSubject =>
      subject.forItem({
        kind: "epic",
        number: epic.number,
        id: epic.id,
        title: epic.title,
        route: "projectEpic",
        params: { epicNumber: String(epic.number) },
      }),

    forQuest: (quest: QuestResource): AgentPromptItemSubject =>
      subject.forItem({
        kind: "quest",
        number: quest.shortId,
        id: quest.id,
        title: quest.title,
        route: "projectQuest",
        params: { shortId: String(quest.shortId) },
      }),

    // Feedback has no page of its own: the inbox, naming the item.
    forFeedback: (feedback: FeedbackResource): AgentPromptItemSubject =>
      subject.forItem({
        kind: "feedback",
        number: feedback.shortId,
        id: feedback.id,
        title: feedback.title,
        route: "projectFeedback",
        query: { feedback: String(feedback.shortId) },
      }),

    forFeedbackInbox: (): AgentPromptProjectSubject =>
      subject.forPage("projectFeedback"),

    forQuestList: (): AgentPromptProjectSubject =>
      subject.forPage("projectQuests"),
  };
};
