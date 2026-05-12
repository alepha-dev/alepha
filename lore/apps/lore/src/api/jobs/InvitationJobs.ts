import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { $logger } from "alepha/logger";
import { InvitationService } from "../services/InvitationService.ts";

export class InvitationJobs {
  protected readonly log = $logger();
  protected readonly invitationService = $inject(InvitationService);

  /**
   * Expire pending invitations that have passed their expiration date.
   */
  public readonly expireInvitations = $job({
    cron: "0 * * * *",
    handler: async () => {
      const count = await this.invitationService.expirePending();
      if (count > 0) {
        this.log.info(`Expired ${count} invitations`);
      }
    },
  });

  /**
   * Purge old resolved invitations.
   */
  public readonly purgeInvitations = $job({
    cron: "0 3 * * *",
    handler: async () => {
      const count = await this.invitationService.purgeResolved();
      if (count > 0) {
        this.log.info(`Purged ${count} old invitations`);
      }
    },
  });
}
