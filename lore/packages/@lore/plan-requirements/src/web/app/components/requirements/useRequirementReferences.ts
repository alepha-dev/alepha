import {
  type ElementReference,
  type ElementReferenceSet,
  type ElementRef,
  formatReference,
} from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";
import { useMemo } from "react";

import type { RequirementController } from "../../../../api/controllers/RequirementController.ts";

/**
 * The requirements an element body can reference (#E153), registered by
 * `RequirementsShell` on core's `ElementReferenceRegistry`. A project has a
 * few dozen at most, so the whole list is both the picker's and what resolves.
 *
 * Fetched only once the project has the `requirements` option: a project
 * without it has no requirement to name, and a refused read stays quiet.
 */
export const useRequirementReferences = (
  element: ElementRef,
  // Unread: every requirement is fetched, whatever the body names.
  _content: string,
): ElementReferenceSet => {
  const requirementApi = useClient<RequirementController>();
  const { projectId } = element;

  const { data: requirements } = useQuery<ElementReference[]>(
    {
      key: ["elementLinks:requirements", projectId],
      enabled: projectId > 0,
      staleTime: [5, "minutes"],
      handler: async () => {
        const rows = await requirementApi.getRequirements({
          params: { projectId },
          query: {},
        });
        return rows.map((p) => ({ number: p.number, title: p.statement }));
      },
      onError: () => {},
    },
    [requirementApi, projectId],
  );

  return useMemo(
    () => ({
      refs: requirements ?? [],
      suggestions: (requirements ?? []).map((p) => {
        const token = formatReference("requirement", p.number);
        return {
          key: `requirement:${p.number}`,
          kind: "requirement",
          token,
          label: p.title,
          hint: token,
        };
      }),
    }),
    [requirements],
  );
};
