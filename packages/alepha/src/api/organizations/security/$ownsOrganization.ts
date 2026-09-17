import type { Middleware } from "alepha";
import { $repository, type Repository } from "alepha/orm";
import { $owns, type OwnsHop, type OwnsOptions } from "alepha/security";

import { organizationMembers } from "../entities/organizationMembers.ts";
import { organizations } from "../entities/organizations.ts";

export const $ownsOrganization = (
  options: OwnsOrganizationOptions,
): Middleware => {
  const organizationRepository = $repository(organizations);
  const memberRepository = $repository(organizationMembers);
  return $owns({
    repository: options.repository ?? (() => organizationRepository),
    param: options.param,
    from: options.from,
    requires: options.requires,
    secure: options.secure,
    through: options.through,
    via: {
      repository: () => memberRepository,
      resource: "organizationId",
      user: "userId",
      key: options.key,
    },
    message: "Not a member of this organization",
  });
};

export interface OwnsOrganizationOptions extends Pick<
  OwnsOptions,
  "param" | "from" | "requires" | "secure"
> {
  repository?: () => Repository<any>;
  through?: OwnsHop | OwnsHop[];
  key?: string;
}
