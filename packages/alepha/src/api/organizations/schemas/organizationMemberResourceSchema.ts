import type { Infer } from "alepha";
import { userResourceSchema } from "alepha/api/users";

import { organizationMembers } from "../entities/organizationMembers.ts";

export const organizationMemberResourceSchema =
  organizationMembers.schema.extend({
    user: userResourceSchema,
  });

export type OrganizationMemberResource = Infer<
  typeof organizationMemberResourceSchema
>;
