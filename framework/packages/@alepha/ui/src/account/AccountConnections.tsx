import type { MyConnection, MyConnectionController } from "alepha/api/users";
import { useClient, useQuery } from "alepha/react";

import { AccountConnectionsView } from "./AccountConnectionsView.tsx";
import { AccountSectionSkeleton } from "./AccountSectionSkeleton.tsx";

export interface AccountConnectionsProps {
  /**
   * Extra classes merged onto the section's frame. The section fetches its
   * own connections; this interface is also the entry of
   * `accountDialogOptionsAtom`'s `pages`, so a prop added here is passable the
   * day it exists.
   */
  className?: string;
}

/**
 * The Connected apps section of the account dialog: fetches the list, then
 * draws it (`AccountConnectionsView`). A skeleton holds the place meanwhile.
 */
const AccountConnections = (props: AccountConnectionsProps) => {
  const api = useClient<MyConnectionController>();
  const { data } = useQuery<MyConnection[]>(
    { handler: () => api.listMyConnections() },
    [api],
  );
  if (!data) {
    return <AccountSectionSkeleton variant="table" />;
  }
  return <AccountConnectionsView {...props} connections={data} />;
};

export default AccountConnections;
