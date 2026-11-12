import type { ApiKeyController, ListApiKeyItem } from "alepha/api/keys";
import { useClient, useQuery } from "alepha/react";

import { AccountKeysView } from "./AccountKeysView.tsx";
import { AccountSectionSkeleton } from "./AccountSectionSkeleton.tsx";

export interface AccountKeysProps {
  /**
   * Extra classes merged onto the section's frame. The section fetches its
   * own keys; this interface is also the entry of
   * `accountDialogOptionsAtom`'s `pages`, so a prop added here is passable the
   * day it exists.
   */
  className?: string;
}

/**
 * The API keys section of the account dialog: fetches the list, then draws
 * it (`AccountKeysView`). A skeleton holds the place meanwhile.
 */
const AccountKeys = (props: AccountKeysProps) => {
  const api = useClient<ApiKeyController>();
  const { data } = useQuery<ListApiKeyItem[]>(
    { handler: async () => (await api.listApiKeys()) as ListApiKeyItem[] },
    [api],
  );
  if (!data) {
    return <AccountSectionSkeleton variant="table" />;
  }
  return <AccountKeysView {...props} apiKeys={data} />;
};

export default AccountKeys;
