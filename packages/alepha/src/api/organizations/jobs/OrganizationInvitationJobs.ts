import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";

import { InvitationService } from "../services/InvitationService.ts";

export class OrganizationInvitationJobs {
  protected readonly invitations = $inject(InvitationService);

  public readonly expireOrganizationInvitations = $job({
    name: "system.organization-invitations.expire",
    description: "Marks pending organization invitations as expired",
    cron: "0 * * * *",
    handler: async () => {
      await this.invitations.expirePending();
    },
  });

  public readonly purgeOrganizationInvitations = $job({
    name: "system.organization-invitations.purge-resolved",
    description: "Purges old resolved organization invitations",
    cron: "0 * * * *",
    handler: async () => {
      await this.invitations.purgeResolved();
    },
  });
}
