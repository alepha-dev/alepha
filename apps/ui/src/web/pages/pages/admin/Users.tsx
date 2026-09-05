import { AdminUsers } from "@alepha/ui/components/admin/admin-users";
import { z } from "alepha";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The one admin component with props worth turning: which columns start hidden.
 *
 * ⚠️ `defaultHiddenColumns` is read once, at mount - the table owns its column
 * visibility from then on, so the reader can hide and show columns from its own
 * menu without a prop fighting them. That makes the knobs below dead unless the
 * table is remounted, which is what the `key` does. Without it the switches
 * moved and the table did not, which reads as a broken component rather than a
 * misused prop.
 */
const KNOBS = z.object({
  hideNames: z.boolean().default(true).meta({ title: "Hide name columns" }),
  hideRoles: z.boolean().default(false).meta({ title: "Hide roles" }),
  hideJoined: z.boolean().default(false).meta({ title: "Hide joined" }),
});

const Users = () => (
  <Showcase
    title="Admin: users"
    description="The user directory."
    schema={KNOBS}
    initialValues={{ hideNames: true, hideRoles: false, hideJoined: false }}
  >
    {(v) => (
      <AdminUsers
        key={`${v.hideNames}-${v.hideRoles}-${v.hideJoined}`}
        defaultHiddenColumns={[
          ...(v.hideNames ? (["firstName", "lastName"] as const) : []),
          ...(v.hideRoles ? (["roles"] as const) : []),
          ...(v.hideJoined ? (["createdAt"] as const) : []),
        ]}
      />
    )}
  </Showcase>
);

export default Users;
