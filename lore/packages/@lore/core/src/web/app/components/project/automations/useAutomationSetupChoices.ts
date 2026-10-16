import { useClient, useQuery, useStore } from "alepha/react";
import { useState } from "react";

import type { AutomationController } from "../../../../../api/controllers/AutomationController.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";

export const useAutomationSetupChoices = (
  kind:
    | "member"
    | "folio"
    | "app"
    | "quest"
    | "release"
    | "epic"
    | "feedback"
    | "deployment",
  enabled: boolean,
) => {
  const [project] = useStore(currentProjectAtom);
  const api = useClient<AutomationController>();
  const [offset, setOffset] = useState(0);
  const read = useQuery(
    {
      key: ["automation-setup-options", project?.id, kind, offset],
      enabled: enabled && !!project,
      handler: ({ signal }) =>
        api.getAutomationSetupOptions(
          {
            params: { projectId: project!.id },
            query: { kind, offset, limit: 50 },
          },
          { request: { signal } },
        ),
    },
    [project?.id, kind, offset, enabled],
  );
  return {
    items: read.data?.items ?? [],
    navigation: {
      offset,
      hasMore: read.data?.hasMore ?? false,
      loading: read.loading,
      previous: () => setOffset((value) => Math.max(0, value - 50)),
      next: () => setOffset((value) => value + 50),
    },
  };
};
