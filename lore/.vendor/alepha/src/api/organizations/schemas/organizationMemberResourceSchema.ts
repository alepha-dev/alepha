import { type Infer, z } from "alepha";
import { userResourceSchema } from "alepha/api/users";

import { organizationMembers } from "../entities/organizationMembers.ts";

export const organizationMemberResourceSchema =
  organizationMembers.schema.extend({
    user: userResourceSchema,
    rankName: z
      .text()
      .describe(
        "The display name of the rank this member holds. Resolved server-side because the rank list is `rank:manage`-gated, and a member who may only read the roster would otherwise see a custom rank's opaque key.",
      )
      .optional(),
  });

export type OrganizationMemberResource = Infer<
  typeof organizationMemberResourceSchema
>;
