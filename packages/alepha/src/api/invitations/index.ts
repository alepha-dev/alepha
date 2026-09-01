import { $module } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaApiVerification } from "alepha/api/verifications";

import { AdminInvitationController } from "./controllers/AdminInvitationController.ts";
import { InvitationJobs } from "./jobs/InvitationJobs.ts";
import { $invitationResource } from "./primitives/$invitationResource.ts";
import { InvitationResourceProvider } from "./providers/InvitationResourceProvider.ts";
import { InvitationRegistrationService } from "./services/InvitationRegistrationService.ts";
import { InvitationService } from "./services/InvitationService.ts";
import { InvitationTokenService } from "./services/InvitationTokenService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./atoms/invitationConfigAtom.ts";
export * from "./controllers/AdminInvitationController.ts";
export * from "./entities/invitations.ts";
export * from "./jobs/InvitationJobs.ts";
export * from "./primitives/$invitationResource.ts";
export * from "./providers/InvitationResourceProvider.ts";
export * from "./schemas/createInvitationSchema.ts";
export * from "./schemas/invitationQuerySchema.ts";
export * from "./schemas/invitationResourceSchema.ts";
export * from "./services/InvitationRegistrationService.ts";
export * from "./services/InvitationService.ts";
export * from "./services/InvitationTokenService.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Invite people to something by email, before they have an account.
 *
 * **Features:**
 * - Invitations addressed to an email, so a stranger can be invited
 * - A status machine: pending to accepted / declined / expired / revoked
 * - A signup token, so an invited stranger can register into a CLOSED realm
 * - Expiry and purge sweeps, on an hourly job
 * - Caps per resource and per inviter
 * - An admin surface behind `admin:invitation:*`
 *
 * The module knows nothing about what is being joined. Declare one
 * `$invitationResource` per `resourceType` to tell it who may invite, whether
 * there is room, who is already a principal, what accepting grants and how
 * the whole thing reads to a human.
 *
 * @module alepha.api.invitations
 */
export const AlephaApiInvitations = $module({
  name: "alepha.api.invitations",
  // `AlephaApiVerification` is what hashes, rate-limits and expires the
  // signup token. Required, not optional: `create` mints one for every
  // invitation.
  imports: [AlephaApiJobs, AlephaApiVerification],
  primitives: [$invitationResource],
  services: [
    InvitationResourceProvider,
    InvitationTokenService,
    InvitationService,
    InvitationRegistrationService,
    InvitationJobs,
    AdminInvitationController,
  ],
});
