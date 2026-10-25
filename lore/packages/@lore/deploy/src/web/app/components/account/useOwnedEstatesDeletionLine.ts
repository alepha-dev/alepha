import type { I18n } from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { EstateController } from "../../../../api/controllers/EstateController.ts";

/**
 * The account-deletion line for the estates this account owns, which go
 * with it (`estates.ownerUserId` cascades, its secret revoked, and every
 * project it was lent to loses a deploy destination, #1838), registered by
 * `DeployShell` on core's `AccountDeletionRegistry` (#E75, #Q2624).
 */
export const useOwnedEstatesDeletionLine = (): string | undefined => {
  const estateApi = useClient<EstateController>();
  const { tr } = useI18n<I18n, "en">();

  const estates = useQuery(
    {
      handler: () => estateApi.countMyEstates(),
      onError: () => {},
    },
    [estateApi],
  ).data;

  if (!estates?.estates) return undefined;
  return String(
    estates.estates === 1
      ? tr("account.delete.estates.one", {
          args: [String(estates.projects)],
        })
      : tr("account.delete.estates.many", {
          args: [String(estates.estates), String(estates.projects)],
        }),
  );
};
