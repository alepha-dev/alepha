import { useClient, useQuery, useStore } from "alepha/react";

import type { HostController } from "../../../../api/controllers/HostController.ts";
import { currentHostAtom } from "../../atoms/currentHostAtom.ts";

/**
 * What the machine last reported, reconciled against what Lore tracks.
 *
 * One request for the whole console: the Overview reads the host block, the
 * Apps table reads the reconciled rows, and the instance page reads one of
 * them. Keyed on the host so all three share a cache entry - crossing
 * between tabs renders immediately and revalidates behind it rather than
 * blanking the page for a round trip.
 *
 * ⚠️ `inventory === null` is an ANSWER, not a failure: a machine that has
 * never connected has no row, and the pages say so in words. Only the host
 * itself 404s.
 */
export const useBayInventory = () => {
  const hostApi = useClient<HostController>();
  const [host] = useStore(currentHostAtom);

  const { data, loading, error, refetch } = useQuery(
    {
      enabled: Boolean(host),
      key: ["bay-inventory", host?.id],
      keepPreviousData: true,
      handler: async () => {
        if (!host) {
          return undefined;
        }
        return await hostApi.getHostInventory({
          params: { hostId: host.id },
        });
      },
    },
    [host?.id],
  );

  return { host, data, loading, error, refetch };
};
