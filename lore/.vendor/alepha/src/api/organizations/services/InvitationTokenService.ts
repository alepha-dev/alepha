import { $inject } from "alepha";
import { VerificationService } from "alepha/api/verifications";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

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

  public async resolve(
    rawToken: string | undefined,
  ): Promise<OrganizationInvitation | undefined> {
    const parsed = this.parse(rawToken);
    if (!parsed) return undefined;
    const invitation = await this.invitations.findById(parsed.id);
    if (
      !invitation ||
      invitation.status !== "pending" ||
      this.dateTime.now().isAfter(invitation.expiresAt)
    ) {
      return undefined;
    }
    try {
      await this.verifications.verifyCode(
        {
          type: "link",
          target: invitation.email,
          purpose: this.purposeFor(invitation.id),
        },
        parsed.secret,
      );
      return invitation;
    } catch {
      return undefined;
    }
  }

  public async inspect(
    rawToken: string | undefined,
  ): Promise<InvitationTokenInspection> {
    const parsed = this.parse(rawToken);
    if (!parsed) return { status: "invalid" };
    const invitation = await this.invitations.findById(parsed.id);
    if (!invitation) return { status: "invalid" };
    if (this.dateTime.now().isAfter(invitation.expiresAt)) {
      return { status: "expired", invitation };
    }
    if (invitation.status !== "pending") {
      return { status: invitation.status, invitation };
    }
    return (await this.resolve(rawToken))
      ? { status: "ok", invitation }
      : { status: "invalid" };
  }

  protected parse(
    rawToken: string | undefined,
  ): { id: string; secret: string } | undefined {
    if (!rawToken) return undefined;
    const separator = rawToken.indexOf(".");
    if (separator <= 0 || separator === rawToken.length - 1) return undefined;
    return {
      id: rawToken.slice(0, separator),
      secret: rawToken.slice(separator + 1),
    };
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
