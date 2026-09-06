import { useClient, useQuery, useStore } from "alepha/react";

import type { EstateController } from "@/api/controllers/EstateController.ts";
import { currentEstateAtom } from "@/web/app/atoms/currentEstateAtom.ts";

/**
 * What the machine last reported, reconciled against what Lore tracks.
 *
 * One request for the whole console: the Overview reads the host block, the
 * Apps table reads the reconciled rows, and the instance page reads one of
 * them. Keyed on the estate so all three share a cache entry - crossing
 * between tabs renders immediately and revalidates behind it rather than
 * blanking the page for a round trip.
 *
 * ⚠️ `inventory === null` is an ANSWER, not a failure: a machine that has
 * never connected has no row, and the pages say so in words. Only the estate
 * itself 404s.
 */
export const useBayInventory = () => {
  const estateApi = useClient<EstateController>();
  const [estate] = useStore(currentEstateAtom);

  const { data, loading, error, refetch } = useQuery(
    {
      enabled: Boolean(estate),
      key: ["bay-inventory", estate?.id],
      keepPreviousData: true,
      handler: async () => {
        if (!estate) {
          return undefined;
        }
        return await estateApi.getEstateInventory({
          params: { estateId: estate.id },
        });
      },
    },
    [estate?.id],
  );

  return { estate, data, loading, error, refetch };
};
