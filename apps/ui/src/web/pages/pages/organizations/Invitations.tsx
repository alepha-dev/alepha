import { MyOrganizationInvitations } from "@alepha/ui/organizations";
import { useRouter } from "alepha/react/router";

import { Showcase } from "@/web/components/Showcase.tsx";

const Invitations = () => {
  const router = useRouter();

  return (
    <Showcase
      id="pages/organizations/Invitations"
      title="Organization invitations"
      description="Invitations waiting for this account."
    >
      {() => (
        <MyOrganizationInvitations
          onAccepted={() => router.push("/pages/organizations/members")}
        />
      )}
    </Showcase>
  );
};

export default Invitations;
