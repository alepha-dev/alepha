import { $inject } from "alepha";
import { VerificationService } from "alepha/api/verifications";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { type InvitationEntity, invitations } from "../entities/invitations.ts";

/**
 * The secret that turns an invitation mail into a way in.
 *
 * Without it, an invitation can only ever say "sign in with this address and
 * open your inbox", which works exactly as long as anybody may register. The
 * moment a realm closes, an invited stranger has no path at all, and the
 * switch is unusable in practice.
 *
 * Built on `alepha/api/verifications` rather than on a column of its own: it
 * already hashes the token, counts attempts, applies a cooldown and a daily
 * limit, and scopes all three per `(type, target, purpose)`. Naming the
 * purpose after the invitation gives every invitation its own window, so one
 * person's retries never throttle another's.
 */
export class InvitationTokenService {
  protected readonly log = $logger();
  protected readonly repo = $repository(invitations);
  protected readonly verifications = $inject(VerificationService);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Mint the token for an invitation. Returned once, to the caller that will
   * put it in the mail; nothing can recover it afterwards.
   *
   * The verification is given the INVITATION's expiry, not the two-hour
   * default a `link` gets: a token that dies before the invitation does is a
   * link that is already broken when the recipient clicks it.
   */
  public async mint(invitation: InvitationEntity): Promise<string> {
    const { token } = await this.verifications.createVerification({
      type: "link",
      target: invitation.email,
      purpose: this.purposeFor(invitation.id),
      expiresAt: invitation.expiresAt,
    });
    // The id travels with the secret because the secret alone identifies
    // nothing: verification rows are looked up by (type, target, purpose),
    // and both the target and the purpose are derived from the invitation.
    // A uuid in a link is not a secret and reveals nothing on its own.
    return `${invitation.id}.${token}`;
  }

  /**
   * The invitation a token opens, or `undefined`.
   *
   * One answer for every way of being wrong: unparseable, unknown, revoked,
   * declined, already accepted, expired, or simply the wrong secret. A caller
   * that reported them apart would let a stranger probe which addresses had
   * been invited, which is the thing the closed realm exists to prevent.
   */
  public async resolve(
    rawToken: string | undefined,
  ): Promise<InvitationEntity | undefined> {
    if (!rawToken) {
      return undefined;
    }
    const separator = rawToken.indexOf(".");
    if (separator <= 0) {
      return undefined;
    }
    const id = rawToken.slice(0, separator);
    const secret = rawToken.slice(separator + 1);
    if (!secret) {
      return undefined;
    }

    const invitation = await this.repo.findOne({ where: { id: { eq: id } } });
    if (!invitation) {
      return undefined;
    }

    // Status first, and this is what makes the token single-use: accepting,
    // declining or revoking an invitation leaves it non-pending, and the
    // token dies with it. Nothing has to remember to revoke the token
    // separately, which is exactly the kind of thing that gets forgotten.
    if (invitation.status !== "pending") {
      return undefined;
    }

    // The sweep that flips overdue rows to `expired` runs hourly, so between
    // sweeps a row can be pending and past its date. Read the date, not the
    // status alone.
    if (this.dateTime.now().isAfter(invitation.expiresAt)) {
      return undefined;
    }

    try {
      await this.verifications.verifyCode(
        {
          type: "link",
          target: invitation.email,
          purpose: this.purposeFor(invitation.id),
        },
        secret,
      );
    } catch (error) {
      this.log.debug("Invitation token rejected", {
        invitationId: invitation.id,
        error: (error as Error).message,
      });
      return undefined;
    }

    return invitation;
  }

  /**
   * The verification purpose for one invitation.
   *
   * Per invitation rather than per address, so two invitations to the same
   * person do not share a cooldown, and never one of the generic buckets:
   * a token minted here must never be redeemable as a password reset, nor a
   * reset token redeemable as an invitation.
   */
  protected purposeFor(invitationId: string): string {
    return `invitation:${invitationId}`;
  }
}
