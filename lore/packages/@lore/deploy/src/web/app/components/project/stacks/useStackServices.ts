import { useClient, useQuery } from "alepha/react";

import type { StackDeployController } from "../../../../../api/controllers/StackDeployController.ts";
import type { StackTarget } from "./stackTarget.ts";

/**
 * A stack environment's services and volumes, as the applied revision
 * declares them and the machine last reported them. Keyed
 * `["stack-services", projectId, environmentId]`.
 */
export const useStackServices = (target: StackTarget) => {
  const api = useClient<StackDeployController>();
  return useQuery(
    {
      key: ["stack-services", target.projectId, target.environmentId],
      keepPreviousData: true,
      handler: async () => await api.listStackServices({ params: target }),
    },
    [target.projectId, target.stackId, target.environmentId],
  );
};
