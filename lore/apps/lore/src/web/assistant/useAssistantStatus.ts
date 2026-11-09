import { useClient, useQuery } from "alepha/react";
import { useAuth } from "alepha/react/auth";

import type { LoreAiStatusController } from "../../assistant/LoreAiStatusController.ts";

/**
 * Whether the assistant answers on this copy, for the signed-in reader
 * (`aiAssistantStatus`). `false` while loading, signed out or on error: the
 * assistant shows only once the server said yes, and a failure stays quiet,
 * since a missing button is the whole answer.
 */
export const useAssistantStatus = (): boolean => {
  const auth = useAuth();
  const api = useClient<LoreAiStatusController>();
  const status = useQuery(
    {
      key: ["ai-assistant-status"],
      handler: () => api.aiAssistantStatus(),
      enabled: !!auth.user,
      onError: () => {},
    },
    [api, auth.user?.id],
  );
  return !!auth.user && status.data?.enabled === true;
};
