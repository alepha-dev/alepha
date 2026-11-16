import {
  type ElementReference,
  type ElementReferenceSet,
  type ElementRef,
  formatReference,
} from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";
import { useMemo } from "react";

import type { PersonaController } from "../../../../api/controllers/PersonaController.ts";

/**
 * The personas an element body can reference (#E153), registered by
 * `RequirementsShell` on core's `ElementReferenceRegistry`. A project has a
 * handful, so the whole list is both the picker's and what resolves.
 *
 * Fetched only once the project has the `requirements` option: a project
 * without it has no persona to name, and a refused read stays quiet.
 */
export const usePersonaReferences = (
  element: ElementRef,
  // Unread: every persona is fetched, whatever the body names.
  _content: string,
): ElementReferenceSet => {
  const personaApi = useClient<PersonaController>();
  const { projectId } = element;

  const { data: personas } = useQuery<ElementReference[]>(
    {
      key: ["elementLinks:personas", projectId],
      enabled: projectId > 0,
      staleTime: [5, "minutes"],
      handler: async () => {
        const rows = await personaApi.getPersonas({
          params: { projectId },
          query: {},
        });
        return rows.map((p) => ({ number: p.number, title: p.name }));
      },
      onError: () => {},
    },
    [personaApi, projectId],
  );

  return useMemo(
    () => ({
      refs: personas ?? [],
      suggestions: (personas ?? []).map((p) => {
        const token = formatReference("persona", p.number);
        return {
          key: `persona:${p.number}`,
          kind: "persona",
          token,
          label: p.title,
          hint: token,
        };
      }),
    }),
    [personas],
  );
};
