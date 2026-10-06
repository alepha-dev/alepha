import type { I18n } from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { QuestAuthorshipController } from "@/api/controllers/QuestAuthorshipController.ts";

/**
 * The account-deletion line for the quests this account authored, which go
 * with it (`quests.createdBy` cascades), registered by `WorkShell` on core's
 * `AccountDeletionRegistry` (#E75, #Q2624). Nothing while loading, on a
 * failure, or for none: "0 quests" is not a consequence.
 */
export const useAuthoredQuestsDeletionLine = (): string | undefined => {
  const api = useClient<QuestAuthorshipController>();
  const { tr } = useI18n<I18n, "en">();

  const count = useQuery(
    {
      handler: () => api.countMyAuthoredQuests(),
      onError: () => {},
    },
    [api],
  ).data?.count;

  if (!count) return undefined;
  return String(
    count === 1
      ? tr("account.delete.quests.one")
      : tr("account.delete.quests.many", { args: [String(count)] }),
  );
};
