import { $atom, z } from "alepha";

export const organizationConfigAtom = $atom({
  name: "alepha.api.organizations.config",
  schema: z.object({
    memberPermissions: z.array(z.string()),
    floor: z.array(z.string()),
    ownerOnly: z.array(z.string()),
    /**
     * Rank keys every organization holds and nobody can delete, beside the
     * `owner` and `member` built-ins (always built in, listed or not). A
     * built-in rank is renamed freely; its permissions stay editable, except
     * the owner's, which are always `*`.
     */
    builtinRanks: z.array(z.string()).optional(),
    /**
     * Ranks every organization holds with no stored row, the way `member`
     * does: until somebody edits one, its permissions are read from here at
     * every read, so a permission the application declares later reaches
     * it. Editing one stores a row, which wins from then on; resetting it
     * deletes the row. A key here is built in, listed in `builtinRanks` or
     * not.
     */
    defaultRanks: z
      .array(
        z.object({
          key: z.string(),
          name: z.string(),
          permissions: z.array(z.string()),
        }),
      )
      .optional(),
    /**
     * Which callers every organization gate (`$ownsOrganization`) lets in
     * without membership: `"any"` (unset), an administrator whose role holds
     * `*` as well as the system user; `"identity"`, the system user alone, so
     * an administrator of the deployment is a stranger to an organization
     * they have not joined. See `SecureOptions.privileged`.
     */
    privileged: z.enum(["any", "identity"]).optional(),
    invitationExpirationDays: z.integer().min(1).max(90),
    maxPendingInvitationsPerOrganization: z.integer().min(1).max(500),
    maxPendingInvitationsPerInviter: z.integer().min(1).max(1000),
    invitationPurgeDays: z.integer().min(0).max(365),
  }),
  default: {
    memberPermissions: [],
    floor: [],
    ownerOnly: ["organization:delete"],
    builtinRanks: ["owner", "member"],
    invitationExpirationDays: 7,
    maxPendingInvitationsPerOrganization: 50,
    maxPendingInvitationsPerInviter: 100,
    invitationPurgeDays: 90,
  },
  serverOnly: true,
});
