import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { invitations } from "../entities/invitations.ts";
import { InvitationTokenService } from "./InvitationTokenService.ts";

/**
 * "This address was invited, let it register even though the realm is
 * closed."
 *
 * Hand it to `$realm({ isPreAuthorized })` and a closed realm stops being all
 * or nothing. Deliberately shaped structurally rather than typed against
 * `alepha/api/users`: this module knows nothing about realms, and should not
 * start importing the user module to say one sentence to it.
 *
 * ```ts
 * realm = $realm({
 *   settings: { registrationAllowed: false },
 *   isPreAuthorized: (context) =>
 *     this.alepha.inject(InvitationRegistrationService).preAuthorize(context),
 * });
 * ```
 */
export class InvitationRegistrationService {
  protected readonly log = $logger();
  protected readonly repo = $repository(invitations);
  protected readonly tokens = $inject(InvitationTokenService);
  protected readonly dateTime = $inject(DateTimeProvider);

  public async preAuthorize(
    context: InvitationPreAuthorizationContext,
  ): Promise<{ emailVerified: boolean } | false> {
    const email = context.email.trim().toLowerCase();

    if (context.method === "oauth") {
      // No token survives an OAuth round trip, and none is needed: the
      // provider has already proven the address, which is the thing the token
      // exists to prove on the other path.
      //
      // ⚠️ Only when it says so outright. `trustProviderEmail` lets an app
      // believe a provider that asserted nothing, and that is a fine default
      // for an OPEN realm; here it would let anyone who registered the
      // invited address at some lax provider walk into the resource. Same
      // posture as the existing-account auto-link, which also demands an
      // explicit yes.
      if (context.emailVerified !== true) {
        this.log.debug(
          "OAuth pre-authorization refused: provider did not verify the address",
          { provider: context.provider },
        );
        return false;
      }
      const pending = await this.findPendingFor(email);
      // The provider owns the verification decision on this path, so nothing
      // is asserted here: `SessionService` reads `profile.email_verified`
      // itself a few lines later.
      return pending ? { emailVerified: false } : false;
    }

    const invitation = await this.tokens.resolve(context.token);
    if (!invitation) {
      return false;
    }

    // Bound to the address. Redeeming an invitation for a different email
    // would register the wrong person into the resource, and the token was
    // delivered to exactly one mailbox.
    if (invitation.email !== email) {
      this.log.warn("Invitation token presented for a different address", {
        invitationId: invitation.id,
      });
      return false;
    }

    // The token arrived in that mailbox, so the address is proven. Sending a
    // verification code as well would be a second round trip the person has
    // no reason to expect, to prove a thing the click already proved.
    return { emailVerified: true };
  }

  /**
   * A live invitation addressed to `email`, if there is one. Any resource
   * will do: the question here is only whether this person was invited to
   * anything at all.
   */
  protected async findPendingFor(email: string) {
    const rows = await this.repo.findMany({
      where: { email: { eq: email }, status: { eq: "pending" } },
      orderBy: { column: "createdAt", direction: "desc" },
      limit: 1,
    });
    const invitation = rows[0];
    if (!invitation) {
      return undefined;
    }
    // The hourly sweep can be up to an hour behind, so an overdue row is
    // still `pending` in the table. Read the date.
    return this.dateTime.now().isAfter(invitation.expiresAt)
      ? undefined
      : invitation;
  }
}

/**
 * What `$realm`'s pre-authorization seam hands over. Restated here, minus the
 * fields this module has no use for, so `alepha/api/invitations` and
 * `alepha/api/users` stay strangers.
 */
export interface InvitationPreAuthorizationContext {
  email: string;
  method: "credentials" | "oauth";
  provider?: string;
  emailVerified?: boolean;
  token?: string;
}
