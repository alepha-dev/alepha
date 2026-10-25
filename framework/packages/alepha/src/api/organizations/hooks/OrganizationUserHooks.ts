import { $hook, $inject } from "alepha";
import { ConflictError } from "alepha/server";

import { OrganizationPolicyProvider } from "../providers/OrganizationPolicyProvider.ts";

export class OrganizationUserHooks {
  protected readonly policy = $inject(OrganizationPolicyProvider);

  public readonly onUserDelete = $hook({
    on: "user:delete:before",
    handler: async ({ userId }) => {
      const owned = await this.policy.ownedBy(userId);
      if (owned.length > 0) {
        throw new ConflictError(
          `Transfer or delete your ${owned.length} organization(s) before deleting your account`,
        );
      }
    },
  });
}
