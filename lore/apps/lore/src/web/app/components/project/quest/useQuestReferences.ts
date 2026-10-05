import { useClient, useQuery } from "alepha/react";
import { useMemo } from "react";

import type { QuestController } from "@/api/controllers/QuestController.ts";

import type { ElementReferenceSet } from "../../../registries/ElementReferenceRegistry.ts";
import type { ElementRef } from "../../shared/element/elementRef.ts";
import { referencedIds } from "../../shared/element/referencedIds.ts";
import { formatReference } from "../../shared/element/typedReference.ts";

/**
 * The quests an element body can reference, registered by `WorkShell` on
 * core's `ElementReferenceRegistry` (#E75, #Q2624).
 *
 * The picker's list is a capped page, sized for the picker: the 100 most
 * recently updated quests, fetched unconditionally because the picker has to
 * offer a quest the moment the author types the second bracket, and that is
 * too late to start a round-trip. A reference is resolved by the numbers the
 * body names instead, through the refs endpoint (#Q2355): before that, a
 * `[[#Q2165]]` to a quest outside the recent page rendered as a broken link
 * in a project holding thousands of them.
 */
export const useQuestReferences = (
  element: ElementRef,
  content: string,
): ElementReferenceSet => {
  const questApi = useClient<QuestController>();
  const { projectId } = element;

  const namedQuestIds = useMemo(
    () => referencedIds(content, "quest").join(","),
    [content],
  );

  const { data: quests } = useQuery<QuestRow[]>(
    {
      key: ["elementLinks:quests", projectId],
      enabled: projectId > 0,
      staleTime: [5, "minutes"],
      handler: async () => {
        const page = await questApi.getQuests({
          params: { projectId },
          // Direct addressing (design §5.3, "never gated"): a link into a
          // draft epic must still resolve, or the reader sees a literal
          // `[[…]]` token and the author cannot even create the link.
          query: {
            size: 100,
            sort: "-updatedAt",
            includeDrafts: true,
          },
        });
        return page.content.map((q) => ({
          shortId: q.shortId,
          title: q.title,
        }));
      },
      onError: () => {},
    },
    [questApi, projectId],
  );

  // Every quest the body names, wherever it would fall in the list above.
  // Kept across a key change so a link does not flash broken while the
  // author adds a reference beside it.
  const { data: namedQuests } = useQuery<QuestRow[]>(
    {
      key: ["elementLinks:quest-refs", projectId, namedQuestIds],
      enabled: namedQuestIds !== "" && projectId > 0,
      staleTime: [5, "minutes"],
      keepPreviousData: true,
      handler: async () =>
        await questApi.listQuestRefs({
          params: { projectId },
          query: { shortIds: namedQuestIds },
        }),
      onError: () => {},
    },
    [questApi, projectId, namedQuestIds],
  );

  return useMemo(
    () => ({
      refs: [...(quests ?? []), ...(namedQuests ?? [])].map((q) => ({
        number: q.shortId,
        title: q.title,
      })),
      suggestions: (quests ?? []).map((q) => {
        const token = formatReference("quest", q.shortId);
        return {
          key: `quest:${q.shortId}`,
          kind: "quest",
          token,
          label: q.title,
          hint: token,
        };
      }),
    }),
    [quests, namedQuests],
  );
};

interface QuestRow {
  shortId: number;
  title: string;
}
