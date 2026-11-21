import { $inject, z } from "alepha";
import { VerificationService } from "alepha/api/verifications";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { NotFoundError } from "alepha/server";

import {
  type OrganizationInvitation,
  organizationInvitations,
} from "../entities/organizationInvitations.ts";

export class InvitationTokenService {
  protected readonly invitations = $repository(organizationInvitations);
  protected readonly verifications = $inject(VerificationService);
  protected readonly dateTime = $inject(DateTimeProvider);

  public async mint(invitation: OrganizationInvitation): Promise<string> {
    const { token } = await this.verifications.createVerification({
      type: "link",
      target: invitation.email,
      purpose: this.purposeFor(invitation.id),
      expiresAt: invitation.expiresAt,
    });
    return `${invitation.id}.${token}`;
  }

  /**
   * The pending, unexpired invitation a link names, or nothing.
   *
   * The secret is checked before anything else is said about the invitation,
   * and a wrong one costs the link nothing: see {@link holdsSecret}.
   */
  public async resolve(
    rawToken: string | undefined,
  ): Promise<OrganizationInvitation | undefined> {
    const inspection = await this.inspect(rawToken);
    return inspection.status === "ok" ? inspection.invitation : undefined;
  }

  /**
   * What a link says about its invitation, for a caller that holds the whole
   * link. A token whose secret is wrong, or whose id half is not an id, is
   * `invalid` whatever the invitation's state: the state, the address and
   * the organization are for the mailbox the link was sent to.
   */
  public async inspect(
    rawToken: string | undefined,
  ): Promise<InvitationTokenInspection> {
    const parsed = this.parse(rawToken);
    if (!parsed) return { status: "invalid" };
    const invitation = await this.invitations.findById(parsed.id);
    if (!invitation || !(await this.holdsSecret(invitation, parsed.secret))) {
      return { status: "invalid" };
    }
    if (invitation.status !== "pending") {
      return { status: invitation.status, invitation };
    }
    if (this.dateTime.now().isAfter(invitation.expiresAt)) {
      return { status: "expired", invitation };
    }
    return { status: "ok", invitation };
  }

  /**
   * Whether `secret` is the one minted for this invitation.
   *
   * Compared against the stored hash directly, never through
   * `VerificationService.verifyCode`: that call spends one of the link's few
   * attempts on a wrong secret, and both callers of this class are
   * unauthenticated (the preview route, a registration), so anybody knowing
   * an invitation's id could lock its real recipient out with three wrong
   * previews. An attempt budget is what protects a six digit code. This
   * secret is a random UUID, 122 random bits, and guessing it is infeasible
   * with or without a counter.
   */
  protected async holdsSecret(
    invitation: OrganizationInvitation,
    secret: string,
  ): Promise<boolean> {
    let stored: string;
    try {
      const entry = await this.verifications.findByEntry({
        type: "link",
        target: invitation.email,
        purpose: this.purposeFor(invitation.id),
      });
      stored = entry.code;
    } catch (error) {
      if (error instanceof NotFoundError) return false;
      throw error;
    }
    return stored === this.verifications.hashCode(secret);
  }

  protected parse(
    rawToken: string | undefined,
  ): { id: string; secret: string } | undefined {
    if (!rawToken) return undefined;
    const separator = rawToken.indexOf(".");
    if (separator <= 0 || separator === rawToken.length - 1) return undefined;
    const id = rawToken.slice(0, separator);
    if (!z.uuid().safeParse(id).success) return undefined;
    return { id, secret: rawToken.slice(separator + 1) };
  }

  protected purposeFor(invitationId: string): string {
    return `invitation:${invitationId}`;
  }
}

export type InvitationTokenInspection =
  | { status: "invalid"; invitation?: undefined }
  | {
      status: "ok" | "expired" | "accepted" | "declined" | "revoked";
      invitation: OrganizationInvitation;
    };
