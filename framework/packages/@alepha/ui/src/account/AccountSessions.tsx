import type { MySession, MySessionController } from "alepha/api/users";
import { useClient, useQuery } from "alepha/react";

import { AccountSectionSkeleton } from "./AccountSectionSkeleton.tsx";
import { AccountSessionsView } from "./AccountSessionsView.tsx";

export interface AccountSessionsProps {
  /**
   * Extra classes merged onto the section's frame. The section fetches its
   * own sessions; this interface is also the entry of
   * `accountDialogOptionsAtom`'s `pages`, so a prop added here is passable the
   * day it exists.
   */
  className?: string;
}

/**
 * The Sessions section of the account dialog: fetches the list, then draws
 * it (`AccountSessionsView`). A skeleton holds the place meanwhile.
 */
const AccountSessions = (props: AccountSessionsProps) => {
  const api = useClient<MySessionController>();
  const { data } = useQuery<MySession[]>(
    { handler: () => api.listMySessions() },
    [api],
  );
  if (!data) {
    return <AccountSectionSkeleton variant="table" />;
  }
  return <AccountSessionsView {...props} sessions={data} />;
};

export default AccountSessions;
