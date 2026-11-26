import { $context } from "alepha";
import { $repository, type Repository } from "alepha/orm";
import {
  $owns,
  type OwnsHop,
  type OwnsOptions,
  type SecureMiddleware,
} from "alepha/security";

import { organizationConfigAtom } from "../atoms/organizationConfigAtom.ts";
import { organizationMembers } from "../entities/organizationMembers.ts";
import { organizations } from "../entities/organizations.ts";

export const $ownsOrganization = (
  options: OwnsOrganizationOptions,
): SecureMiddleware => {
  const { alepha } = $context();
  const organizationRepository = $repository(organizations);
  const memberRepository = $repository(organizationMembers);
  return $owns({
    repository: options.repository ?? (() => organizationRepository),
    param: options.param,
    from: options.from,
    resolve: options.resolve,
    requires: options.requires,
    secure: options.secure,
    cache: options.cache,
    through: options.through,
    // The gate's own word, else the application's (`privileged` in the
    // organizations config), read per request so a module setting it at
    // registration reaches the framework's own organization routes too.
    privileged:
      options.privileged ??
      (() => alepha.store.get(organizationConfigAtom).privileged),
    via: {
      repository: () => memberRepository,
      resource: "organizationId",
      user: "userId",
      key: options.key,
    },
    message: options.message ?? "Not a member of this organization",
  });
};

export interface OwnsOrganizationOptions extends Pick<
  OwnsOptions,
  | "param"
  | "from"
  | "resolve"
  | "requires"
  | "secure"
  | "cache"
  | "message"
  | "privileged"
> {
  repository?: () => Repository<any>;
  through?: OwnsHop | OwnsHop[];
  key?: string;
}
