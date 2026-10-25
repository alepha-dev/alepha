import { users } from "alepha/api/users";
import { $relations } from "alepha/orm";

import { organizationMembers } from "../entities/organizationMembers.ts";

export const organizationRelations = $relations(
  { users, organizationMembers },
  (r) => ({
    organizationMembers: {
      user: r.one.users({
        from: r.organizationMembers.userId,
        to: r.users.id,
      }),
    },
  }),
);
