import {
  type ElementReference,
  type ElementReferenceSet,
  type ElementRef,
  formatReference,
} from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";
import { useMemo } from "react";

import type { UseCaseController } from "../../../../api/controllers/UseCaseController.ts";

/**
 * The useCases an element body can reference (#E153), registered by
 * `RequirementsShell` on core's `ElementReferenceRegistry`. A project has a
 * few dozen at most, so the whole list is both the picker's and what resolves.
 *
 * Fetched only once the project has the `requirements` option: a project
 * without it has no use case to name, and a refused read stays quiet.
 */
export const useUseCaseReferences = (
  element: ElementRef,
  // Unread: every use case is fetched, whatever the body names.
  _content: string,
): ElementReferenceSet => {
  const useCaseApi = useClient<UseCaseController>();
  const { projectId } = element;

  const { data: useCases } = useQuery<ElementReference[]>(
    {
      key: ["elementLinks:useCases", projectId],
      enabled: projectId > 0,
      staleTime: [5, "minutes"],
      handler: async () => {
        const rows = await useCaseApi.getUseCases({
          params: { projectId },
          query: {},
        });
        return rows.map((p) => ({ number: p.number, title: p.title }));
      },
      onError: () => {},
    },
    [useCaseApi, projectId],
  );

  return useMemo(
    () => ({
      refs: useCases ?? [],
      suggestions: (useCases ?? []).map((p) => {
        const token = formatReference("usecase", p.number);
        return {
          key: `usecase:${p.number}`,
          kind: "usecase",
          token,
          label: p.title,
          hint: token,
        };
      }),
    }),
    [useCases],
  );
};
