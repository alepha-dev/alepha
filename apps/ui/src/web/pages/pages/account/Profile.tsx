import AccountProfile from "@alepha/ui/components/account/account-profile";
import { z } from "alepha";

import { Showcase } from "@/web/components/Showcase.tsx";
import { SHOWCASE_PROFILE } from "@/web/pages/pages/account/accountFixtures.ts";

/**
 * Every account component takes its data as an OPTIONAL prop and calls the API
 * only for mutations, which is what lets this whole surface render with no
 * session behind it.
 *
 * Absent data is the loading state rather than an error, so the knob below is a
 * real second rendering and not a stubbed-out one.
 */
const KNOBS = z.object({
  loading: z.boolean().default(false).meta({ title: "No data yet" }),
});

const Profile = () => (
  <Showcase
    id="pages/account/Profile"
    title="Profile"
    description="Name, email and the roles a realm granted."
    schema={KNOBS}
    initialValues={{ loading: false }}
  >
    {(v) => (
      <div className="mx-auto max-w-3xl">
        <AccountProfile profile={v.loading ? undefined : SHOWCASE_PROFILE} />
      </div>
    )}
  </Showcase>
);

export default Profile;
