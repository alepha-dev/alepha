import { useClient, useQuery } from "alepha/react";
import { useMemo } from "react";

import type { FeedbackController } from "@/api/controllers/FeedbackController.ts";

import type { ElementReferenceSet } from "../../../registries/ElementReferenceRegistry.ts";
import type { ElementRef } from "../../shared/element/elementRef.ts";
import type { ElementReference } from "../../shared/element/wikiLinkResolver.ts";

/**
 * The feedback items an element body can reference, registered by
 * `WorkShell` on core's `ElementReferenceRegistry` (#E75, #Q2624).
 *
 * The inbox is paged, so an item's title cannot be read off a list the page
 * already holds the way a release's can. Three columns for the whole inbox,
 * fetched only when a body names one, so a plain `[[#Q42]]` never pays for
 * them. Not offered by the picker.
 */
export const useFeedbackReferences = (
  element: ElementRef,
  content: string,
): ElementReferenceSet => {
  const feedbackApi = useClient<FeedbackController>();
  const { projectId } = element;
  const named = /\[\[\s*#p\d+\s*\]\]/i.test(content);

  const { data: feedbackRefs } = useQuery<ElementReference[]>(
    {
      key: ["elementLinks:feedback", projectId],
      enabled: named && projectId > 0,
      staleTime: [5, "minutes"],
      handler: async () =>
        (await feedbackApi.listFeedbackRefs({ params: { projectId } })).map(
          (f) => ({ number: f.shortId, title: f.title, status: f.status }),
        ),
      onError: () => {},
    },
    [feedbackApi, projectId, named],
  );

  return useMemo(() => ({ refs: feedbackRefs ?? [] }), [feedbackRefs]);
};
