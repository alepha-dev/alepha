import type {
  MyProfile,
  MyProfileController,
  RealmConfig,
  RealmController,
} from "alepha/api/users";
import { useClient, useQuery } from "alepha/react";

import { AccountProfileView } from "./AccountProfileView.tsx";
import { AccountSectionSkeleton } from "./AccountSectionSkeleton.tsx";

export interface AccountProfileProps {
  /**
   * Extra classes merged onto the section's frame. The section fetches its
   * own profile; this interface is also the entry of
   * `accountDialogOptionsAtom`'s `pages`, so a prop added here is passable the
   * day it exists.
   */
  className?: string;
}

/**
 * The Profile section of the account dialog: fetches the profile and the
 * realm's configuration together, then draws the form
 * (`AccountProfileView`). The form reads its initial values once, at mount,
 * which is why it mounts only when the profile is there.
 *
 * `realmConfig` rides along because the page has one realm-dependent field:
 * a realm with `username: "none"` or `"email"` has no handle to edit. Both
 * are fetched at once rather than in sequence: they do not depend on each
 * other.
 */
const AccountProfile = (props: AccountProfileProps) => {
  const api = useClient<MyProfileController>();
  const realmApi = useClient<RealmController>();
  const { data } = useQuery(
    {
      handler: async () => {
        const [profile, realmConfig] = await Promise.all([
          api.getMyProfile(),
          realmApi.getRealmConfig(),
        ]);
        return { profile, realmConfig };
      },
    },
    [api, realmApi],
  );
  if (!data) {
    return <AccountSectionSkeleton variant="form" />;
  }
  return (
    <AccountProfileView
      {...props}
      profile={data.profile as MyProfile}
      realmConfig={data.realmConfig as RealmConfig}
    />
  );
};

export default AccountProfile;
