import { MyOrganizations } from "@alepha/ui/organizations";
import { useRouter } from "alepha/react/router";

import { Showcase } from "@/web/components/Showcase.tsx";

const Organizations = () => {
  const router = useRouter();

  return (
    <Showcase
      id="pages/organizations/Organizations"
      title="Organizations"
      description="The organizations this account belongs to."
    >
      {() => (
        <MyOrganizations
          onOpen={() => router.push("/pages/organizations/members")}
        />
      )}
    </Showcase>
  );
};

export default Organizations;
