import type {
  MyIdentity,
  MyIdentityController,
  RealmConfig,
  RealmController,
} from "alepha/api/users";
import { useClient, useQuery } from "alepha/react";
import type { ReactNode } from "react";

import { AccountSectionSkeleton } from "./AccountSectionSkeleton.tsx";
import { AccountSecurityView } from "./AccountSecurityView.tsx";

export interface AccountSecurityProps {
  /**
   * Rendered inside the delete-account dialog, above the confirmation field.
   * See `AccountDeleteDialogProps.warning`: this is how an application
   * states what deletion costs in *its* data.
   */
  deleteWarning?: ReactNode;
}

/**
 * The Security section of the account dialog: fetches the identities and
 * the realm's configuration together, then draws the page
 * (`AccountSecurityView`). `realmConfig` rides along because one row is
 * realm-dependent: a realm with `mfa.totp: "disabled"` must not be offered
 * the two-factor row.
 */
const AccountSecurity = (props: AccountSecurityProps) => {
  const api = useClient<MyIdentityController>();
  const realmApi = useClient<RealmController>();
  const { data } = useQuery(
    {
      handler: async () => {
        const [identities, realmConfig] = await Promise.all([
          api.listMyIdentities(),
          realmApi.getRealmConfig(),
        ]);
        return { identities, realmConfig };
      },
    },
    [api, realmApi],
  );
  if (!data) {
    return <AccountSectionSkeleton variant="form" />;
  }
  return (
    <AccountSecurityView
      {...props}
      identities={data.identities as MyIdentity[]}
      realmConfig={data.realmConfig as RealmConfig}
    />
  );
};

export default AccountSecurity;
