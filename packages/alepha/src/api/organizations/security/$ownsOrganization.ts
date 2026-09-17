import type { Middleware } from "alepha";
import { $repository } from "alepha/orm";
import { $owns, type OwnsOptions } from "alepha/security";

import { organizationMembers } from "../entities/organizationMembers.ts";
import { organizations } from "../entities/organizations.ts";

export const $ownsOrganization = (
  options: OwnsOrganizationOptions,
): Middleware => {
  const organizationRepository = $repository(organizations);
  const memberRepository = $repository(organizationMembers);
  return $owns({
    repository: () => organizationRepository,
    param: options.param,
    from: options.from,
    requires: options.requires,
    secure: options.secure,
    via: {
      repository: () => memberRepository,
      resource: "organizationId",
      user: "userId",
    },
    message: "Not a member of this organization",
  });
};

export interface OwnsOrganizationOptions extends Pick<
  OwnsOptions,
  "param" | "from" | "requires" | "secure"
> {}
