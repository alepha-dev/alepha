import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { organizationInvitations } from "../entities/organizationInvitations.ts";
import { InvitationTokenService } from "./InvitationTokenService.ts";

export class InvitationRegistrationService {
  protected readonly invitations = $repository(organizationInvitations);
  protected readonly tokens = $inject(InvitationTokenService);
  protected readonly dateTime = $inject(DateTimeProvider);

  public async preAuthorize(
    context: InvitationPreAuthorizationContext,
  ): Promise<{ emailVerified: boolean } | false> {
    const email = context.email.trim().toLowerCase();
    if (context.method === "oauth") {
      if (context.emailVerified !== true) return false;
      return (await this.findPendingFor(email))
        ? { emailVerified: false }
        : false;
    }
    const invitation = await this.tokens.resolve(context.token);
    if (!invitation || invitation.email !== email) return false;
    return { emailVerified: true };
  }

  protected async findPendingFor(email: string) {
    const rows = await this.invitations.findMany({
      where: { email: { eq: email }, status: { eq: "pending" } },
      orderBy: { column: "createdAt", direction: "desc" },
      limit: 1,
    });
    const invitation = rows[0];
    return invitation && !this.dateTime.now().isAfter(invitation.expiresAt)
      ? invitation
      : undefined;
  }
}

export interface InvitationPreAuthorizationContext {
  email: string;
  method: "credentials" | "oauth";
  provider?: string;
  emailVerified?: boolean;
  token?: string;
}
