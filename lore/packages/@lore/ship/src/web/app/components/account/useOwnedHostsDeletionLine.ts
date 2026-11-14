import type { I18n } from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { HostController } from "../../../../api/controllers/HostController.ts";

/**
 * The account-deletion line for the hosts with no home project anchored on
 * this account, which go with it (`hosts.ownerUserId` cascades, its secret
 * revoked, and every project it was lent to loses a deploy destination,
 * #1838). A homed host outlives the account and is not counted (#E126).
 * Registered by
 * `DeployShell` on core's `AccountDeletionRegistry` (#E75, #Q2624).
 */
export const useOwnedHostsDeletionLine = (): string | undefined => {
  const hostApi = useClient<HostController>();
  const { tr } = useI18n<I18n, "en">();

  const hosts = useQuery(
    {
      handler: () => hostApi.countMyHosts(),
      onError: () => {},
    },
    [hostApi],
  ).data;

  if (!hosts?.hosts) return undefined;
  return String(
    hosts.hosts === 1
      ? tr("account.delete.hosts.one", {
          args: [String(hosts.projects)],
        })
      : tr("account.delete.hosts.many", {
          args: [String(hosts.hosts), String(hosts.projects)],
        }),
  );
};
