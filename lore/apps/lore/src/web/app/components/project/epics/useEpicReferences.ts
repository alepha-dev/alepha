import { useClient, useQuery } from "alepha/react";
import { useMemo } from "react";

import type { EpicController } from "@/api/controllers/EpicController.ts";

import type { ElementReferenceSet } from "../../../registries/ElementReferenceRegistry.ts";
import type { ElementRef } from "../../shared/element/elementRef.ts";
import { formatReference } from "../../shared/element/typedReference.ts";
import type { ElementReference } from "../../shared/element/wikiLinkResolver.ts";

/**
 * The epics an element body can reference, registered by `WorkShell` on
 * core's `ElementReferenceRegistry` (#E75, #Q2624). A project has few of
 * them, so the whole list is both the picker's and what resolves.
 */
export const useEpicReferences = (
  element: ElementRef,
  // Unread: every epic is fetched, whatever the body names.
  _content: string,
): ElementReferenceSet => {
  const epicApi = useClient<EpicController>();
  const { projectId } = element;

  const { data: epics } = useQuery<ElementReference[]>(
    {
      key: ["elementLinks:epics", projectId],
      enabled: projectId > 0,
      staleTime: [5, "minutes"],
      handler: async () => {
        const rows = await epicApi.getEpics({ params: { projectId } });
        return rows.map((e) => ({ number: e.number, title: e.title }));
      },
      onError: () => {},
    },
    [epicApi, projectId],
  );

  return useMemo(
    () => ({
      refs: epics ?? [],
      suggestions: (epics ?? []).map((e) => {
        const token = formatReference("epic", e.number);
        return {
          key: `epic:${e.number}`,
          kind: "epic",
          token,
          label: e.title,
          hint: token,
        };
      }),
    }),
    [epics],
  );
};
