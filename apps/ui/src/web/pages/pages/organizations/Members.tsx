import { OrganizationMembers } from "@alepha/ui/organizations";
import { useStore } from "alepha/react";
import { currentUserAtom } from "alepha/security";

import { Showcase } from "@/web/components/Showcase.tsx";
import { SHOWCASE_PROFILE } from "@/web/pages/pages/account/accountFixtures.ts";

const ORGANIZATION_ID = "00000000-0000-4000-a000-000000000001";

const Members = () => {
  useStore(currentUserAtom, SHOWCASE_PROFILE);

  return (
    <Showcase
      id="pages/organizations/Members"
      title="Organization: members"
      description="Members, pending invitations, rank assignment, and ownership transfer."
    >
      {() => (
        <OrganizationMembers
          organizationId={ORGANIZATION_ID}
          can={() => true}
        />
      )}
    </Showcase>
  );
};

export default Members;
