import { OrganizationRanks } from "@alepha/ui/organizations";

import { Showcase } from "@/web/components/Showcase.tsx";

const ORGANIZATION_ID = "00000000-0000-4000-a000-000000000001";

const Ranks = () => (
  <Showcase
    id="pages/organizations/Ranks"
    title="Organization: ranks"
    description="Permission matrix, built-in ranks, and custom ranks."
  >
    {() => (
      <OrganizationRanks
        organizationId={ORGANIZATION_ID}
        presets={[
          {
            key: "viewer",
            name: "Viewer",
            permissions: ["organization:read", "member:read"],
          },
        ]}
      />
    )}
  </Showcase>
);

export default Ranks;
