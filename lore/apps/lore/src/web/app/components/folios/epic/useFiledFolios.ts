import type { ResourceTabSubject } from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";

import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { FolioResource } from "@/api/schemas/folioResourceSchema.ts";

/**
 * The folios filed under an epic, registered by `KnowledgeShell` as the
 * epic page's Folios tab (#E75, #Q2624).
 *
 * Keyed `["folios", projectId, { epicId }]` (#E59, rule 7): every attach and
 * detach invalidates it, so the picker and the list never show stale
 * membership. `epicId` filters server-side (`FolioController.list`) rather
 * than fetching the project's folios and filtering client-side: a
 * client-side filter over a `limit`-capped, epic-blind page can drop an
 * attached folio entirely once the project holds more than the page size,
 * with no signal that anything was hidden.
 *
 * ⚠️ The answer carries the epic it was read for. `keepPreviousData` keeps
 * the rows on screen while an attach re-reads them, and it would also keep
 * them across a switch to another epic; the id check is what refuses the
 * second. `folios` is `null` until it resolves, so a failed reload never
 * reads as an epic with nothing in it.
 */
export const useFiledFolios = (
  subject: ResourceTabSubject,
): { folios: FolioResource[] | null; count?: number; loading: boolean } => {
  const folioApi = useClient<FolioController>();

  const query = useQuery(
    {
      key: ["folios", subject.projectId, { epicId: subject.id }],
      enabled: subject.projectId > 0,
      keepPreviousData: true,
      handler: async () => ({
        epicId: subject.id,
        items: await folioApi.list({
          query: {
            projectId: subject.projectId,
            epicId: subject.id,
            limit: 100,
          },
        }),
      }),
    },
    [folioApi, subject.projectId, subject.id],
  );

  const folios = query.data?.epicId === subject.id ? query.data.items : null;
  return { folios, count: folios?.length, loading: query.loading };
};
