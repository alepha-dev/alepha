import type { AiChatToolLabel } from "@alepha/ui/ai";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { useCallback } from "react";

/**
 * Every tool the assistant may run, read and write (#Q3209, #Q3210, #Q3212):
 * each has `assistant.tool.<name>.running` and `.done` in both dictionaries,
 * under the `assistant.tool.` dynamic prefix `check:i18n` is told about.
 */
const LABELLED = new Set([
  "project_list",
  "project_info",
  "quest_list",
  "quest_get",
  "getEpicRefs",
  "epic_get",
  "folio_search",
  "folio_get",
  "release_list",
  "release_get",
  "feedback_list",
  "feedback_get",
  "search",
  "searchDocs",
  "quest_create",
  "quest_comment_add",
  "quest_update",
  "quest_complete",
  "folio_create",
]);

/**
 * Names each tool step in the reader's words (#Q3211): "Listing quests"
 * while it runs, "Listed quests" once done, and the running label marked
 * failed or cancelled otherwise. A tool outside the set keeps `AiChat`'s
 * default line.
 */
export const useAssistantToolLabel = (): AiChatToolLabel => {
  const { tr } = useI18n<I18n, "en">();
  return useCallback<AiChatToolLabel>(
    (name, state) => {
      if (!LABELLED.has(name)) {
        return undefined;
      }
      const key = (suffix: "running" | "done") =>
        `assistant.tool.${name}.${suffix}` as Parameters<typeof tr>[0];
      if (state === "done") {
        return tr(key("done"));
      }
      if (state === "running") {
        return tr(key("running"));
      }
      return tr(
        state === "failed" ? "assistant.tool.failed" : "assistant.tool.denied",
        { args: [tr(key("running"))] },
      );
    },
    [tr],
  );
};
