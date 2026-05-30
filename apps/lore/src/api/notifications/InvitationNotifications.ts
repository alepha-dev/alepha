import { $hook, $inject, Alepha, t } from "alepha";
import { $notification } from "alepha/api/notifications";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { campaigns } from "../entities/campaigns.ts";

export class InvitationNotifications {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly campaigns = $repository(campaigns);

  protected escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Ping email: tells the invited address that they've been invited and
   * to find the invitation in their profile inbox. No token, no magic
   * link — the email simply nudges. If the recipient has no account yet,
   * they must register with the invited address first; the inbox is
   * gated on (case-insensitive) email match.
   */
  public readonly invitationInvite = $notification({
    category: "tasks",
    description:
      "Email sent to the invited address when a campaign owner sends a new invitation. Points the recipient to their profile invitations page where they can accept or decline.",
    email: {
      subject: "You have been invited to a campaign",
      body: (it) => {
        const campaignTitle = this.escapeHtml(it.campaignTitle);
        const inviterName = this.escapeHtml(it.inviterName);
        const invitedEmail = this.escapeHtml(it.invitedEmail);
        const inboxUrl = encodeURI(it.inboxUrl);
        return `
        <h1>${campaignTitle}</h1>
        <p>Hi,</p>
        <p><strong>${inviterName}</strong> has invited you to join the campaign <strong>${campaignTitle}</strong> on Lore.</p>
        <p>The invitation is waiting in your profile inbox. To accept or decline, sign in to Lore with <strong>${invitedEmail}</strong> and open the invitations page:</p>
        <p>
          <a href="${inboxUrl}" style="display: inline-block; padding: 10px 20px; background-color: #4f46e5; color: white; text-decoration: none; border-radius: 6px;">
            Open my invitations
          </a>
        </p>
        <p>If you don't have a Lore account yet, please create one with <strong>${invitedEmail}</strong> first — the invitation is bound to that address.</p>
        <p>This invitation will expire in ${it.expiresInDays} days.</p>
      `;
      },
    },
    schema: t.object({
      campaignTitle: t.string(),
      inviterName: t.string(),
      invitedEmail: t.string(),
      inboxUrl: t.string(),
      expiresInDays: t.number(),
    }),
  });

  protected onInvitationCreated = $hook({
    on: "invitation:created",
    handler: async ({ invitation, inviter }) => {
      try {
        const campaign = await this.campaigns.findOne({
          where: { id: { eq: Number(invitation.resourceId) } },
        });
        if (!campaign) {
          this.log.warn("Skipping invitation email — campaign not found", {
            invitationId: invitation.id,
            resourceId: invitation.resourceId,
          });
          return;
        }

        const expiresAt = new Date(invitation.expiresAt).getTime();
        const createdAt = new Date(invitation.createdAt).getTime();
        const expiresInDays = Math.max(
          1,
          Math.round((expiresAt - createdAt) / (1000 * 60 * 60 * 24)),
        );

        const baseUrl = this.alepha.env.PUBLIC_URL ?? "";
        const inboxUrl = `${baseUrl}/auth/profile/invitations`;

        const inviterName = inviter.email
          ? inviter.email.includes("@")
            ? inviter.email.slice(0, inviter.email.indexOf("@"))
            : inviter.email
          : "A campaign owner";

        await this.invitationInvite.push({
          contact: invitation.email,
          variables: {
            campaignTitle: campaign.title,
            inviterName,
            invitedEmail: invitation.email,
            inboxUrl,
            expiresInDays,
          },
        });
      } catch (error) {
        this.log.warn("Failed to enqueue invitation email", {
          invitationId: invitation.id,
          error,
        });
      }
    },
  });
}
