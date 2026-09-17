import { $atom, z } from "alepha";

export const organizationConfigAtom = $atom({
  name: "alepha.api.organizations.config",
  schema: z.object({
    memberPermissions: z.array(z.string()),
    floor: z.array(z.string()),
    ownerOnly: z.array(z.string()),
    invitationExpirationDays: z.integer().min(1).max(90),
    maxPendingInvitationsPerOrganization: z.integer().min(1).max(500),
    maxPendingInvitationsPerInviter: z.integer().min(1).max(1000),
    invitationPurgeDays: z.integer().min(0).max(365),
  }),
  default: {
    memberPermissions: [],
    floor: [],
    ownerOnly: ["organization:delete"],
    invitationExpirationDays: 7,
    maxPendingInvitationsPerOrganization: 50,
    maxPendingInvitationsPerInviter: 100,
    invitationPurgeDays: 90,
  },
  serverOnly: true,
});
