import { $module } from "alepha";
import { AdminInvitationController } from "./controllers/AdminInvitationController.ts";
import { InvitationController } from "./controllers/InvitationController.ts";
import { InvitationJobs } from "./jobs/InvitationJobs.ts";
import { InvitationService } from "./services/InvitationService.ts";

export * from "./controllers/AdminInvitationController.ts";
export * from "./controllers/InvitationController.ts";
export * from "./entities/invitations.ts";
export * from "./jobs/InvitationJobs.ts";
export * from "./providers/InvitationProvider.ts";
export * from "./schemas/createInvitationSchema.ts";
export * from "./schemas/invitationConfigAtom.ts";
export * from "./schemas/invitationQuerySchema.ts";
export * from "./schemas/invitationResourceSchema.ts";
export * from "./schemas/invitationWithResourceInfoSchema.ts";
export * from "./schemas/myInvitationsQuerySchema.ts";
export * from "./services/InvitationService.ts";

declare module "alepha" {
  interface Hooks {
    "invitation:created": {
      invitation: import("./entities/invitations.ts").InvitationEntity;
      token: string;
      inviter: { id: string; email?: string };
    };
    "invitation:accepted": {
      invitation: import("./entities/invitations.ts").InvitationEntity;
      acceptedBy: { id: string; email?: string };
    };
    "invitation:declined": {
      invitation: import("./entities/invitations.ts").InvitationEntity;
      declinedBy: { id: string; email?: string };
    };
    "invitation:expired": {
      invitation: import("./entities/invitations.ts").InvitationEntity;
    };
    "invitation:revoked": {
      invitation: import("./entities/invitations.ts").InvitationEntity;
      revokedBy: { id: string };
    };
  }
}

/**
 * Invitation management module — create, accept, decline, revoke, and expire invitations.
 *
 * @module alepha.api.invitations
 */
export const AlephaApiInvitations = $module({
  name: "alepha.api.invitations",
  services: [
    InvitationService,
    InvitationJobs,
    InvitationController,
    AdminInvitationController,
  ],
});
