import type { AiChatToolSummary } from "@alepha/ui/ai";
import type { I18n } from "@lore/core/web";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import { ToolTrace, type ToolKind } from "../services/toolTrace.ts";

// Spelled out, so the i18n check finds every key it reads.
const KIND_LABELS = {
  quest: {
    one: "chat.agent.trace.quest.one",
    other: "chat.agent.trace.quest.other",
  },
  epic: {
    one: "chat.agent.trace.epic.one",
    other: "chat.agent.trace.epic.other",
  },
  folio: {
    one: "chat.agent.trace.folio.one",
    other: "chat.agent.trace.folio.other",
  },
  release: {
    one: "chat.agent.trace.release.one",
    other: "chat.agent.trace.release.other",
  },
  feedback: {
    one: "chat.agent.trace.feedback.one",
    other: "chat.agent.trace.feedback.other",
  },
  project: {
    one: "chat.agent.trace.project",
    other: "chat.agent.trace.project",
  },
  search: {
    one: "chat.agent.trace.search.one",
    other: "chat.agent.trace.search.other",
  },
  other: {
    one: "chat.agent.trace.other.one",
    other: "chat.agent.trace.other.other",
  },
} as const;

/**
 * The folded line over an agent's tool calls, "Read 6 quests, 1 folio",
 * for the shared `AiChatToolTrace` (#Q4212): Lore's chat rooms and its
 * assistant panel say the same thing in the same words.
 */
export const useChatToolSummary = (): AiChatToolSummary => {
  const { tr } = useI18n<I18n, "en">();
  const trace = useInject(ToolTrace);
  return (tools) => {
    const counted = (items: Array<{ kind: ToolKind; count: number }>) =>
      items
        .map(({ kind, count }) =>
          tr(KIND_LABELS[kind][count === 1 ? "one" : "other"], {
            args: [String(count)],
          }),
        )
        .join(", ");
    const { read, changed } = trace.summarize(tools);
    return read.length && changed.length
      ? tr("chat.agent.trace.readAndChanged", {
          args: [counted(read), counted(changed)],
        })
      : changed.length
        ? tr("chat.agent.trace.changed", { args: [counted(changed)] })
        : read.length
          ? tr("chat.agent.trace.read", { args: [counted(read)] })
          : tr("chat.agent.trace.failed");
  };
};
