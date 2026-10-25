import type { SelectOption } from "@alepha/ui/form";
import { useClient, useQuery, useStore } from "alepha/react";
import { useCallback } from "react";

import type { AutomationController } from "../../../../../api/controllers/AutomationController.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";

export type AutomationOptionKind =
  | "member"
  | "folio"
  | "app"
  | "quest"
  | "release"
  | "epic"
  | "feedback"
  | "deployment";

/**
 * Below a full page the picker filters what it already holds; a full page
 * (the endpoint caps at 50) switches it to asking the server on every search.
 */
export const AUTOMATION_OPTION_THRESHOLD = 49;

/**
 * A `ControlSelect` loader over one kind of project record: the first page
 * on open, the server's own search past it, and the saved value resolved to
 * its label so a long list still names what is selected.
 */
export const useAutomationOptions = (kind: AutomationOptionKind) => {
  const [project] = useStore(currentProjectAtom);
  const api = useClient<AutomationController>();
  const projectId = project?.id;
  return useCallback(
    async (search: string, resolve?: string[]): Promise<SelectOption[]> => {
      if (!projectId) return [];
      const page = await api.getAutomationSetupOptions({
        params: { projectId },
        query: {
          kind,
          offset: 0,
          limit: 50,
          ...(search ? { search } : {}),
          ...(resolve?.length ? { ids: resolve.join(",") } : {}),
        },
      });
      return page.items;
    },
    [api, projectId, kind],
  );
};

/**
 * The labels of saved values, for read-only summaries that would otherwise
 * print a member's or a folio's id.
 */
export const useAutomationOptionLabels = (
  kind: AutomationOptionKind,
  ids: string[],
) => {
  const [project] = useStore(currentProjectAtom);
  const api = useClient<AutomationController>();
  const joined = [...new Set(ids.filter(Boolean))].sort().join(",");
  const read = useQuery(
    {
      key: ["automation-option-labels", project?.id, kind, joined],
      enabled: !!project && !!joined,
      handler: ({ signal }) =>
        api.getAutomationSetupOptions(
          {
            params: { projectId: project!.id },
            query: { kind, offset: 0, limit: 50, ids: joined },
          },
          { request: { signal } },
        ),
      // A label is a nicety: without one the summary falls back to the value.
      onError: () => {},
    },
    [project?.id, kind, joined],
  );
  return new Map(
    (read.data?.items ?? []).map((item) => [item.value, item.label]),
  );
};
