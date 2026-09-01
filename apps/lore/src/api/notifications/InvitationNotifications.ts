import { $hook, $inject, Alepha, z } from "alepha";
import { $notification } from "alepha/api/notifications";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { projects } from "../entities/projects.ts";

export class InvitationNotifications {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly projects = $repository(projects);

  protected escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * The invitation mail. One link, and the link does the work.
   *
   * It used to carry no token and tell the recipient to go and create an
   * account first, then find the invitation in their profile inbox. That is
   * two manual steps in the best case, and in a realm with registration
   * closed the first of them is impossible - which made the switch unusable
   * rather than merely strict.
   *
   * The link now carries the invitation's own token (`#1655`). It lands on
   * the register page, which pre-fills the address, renders the form even
   * when the realm is closed, and sends somebody who already has an account
   * to sign in instead. So the same single link serves both cases, and the
   * profile inbox remains what it always was: where the invitation waits if
   * the link is never clicked.
   *
   * ⚠️ `acceptUrl` carries a secret. It is built here and nowhere else, it is
   * not logged, and it must never be put in a subject line, an analytics
   * event or a redirect that leaves the app.
   */
  public readonly invitationInvite = $notification({
    category: "tasks",
    description:
      "Email sent to the invited address when a project owner sends a new invitation. Carries a one-time link that lets the recipient join, whether or not they already have an account.",
    email: {
      subject: "You have been invited to a project",
      body: (it) => {
        const projectTitle = this.escapeHtml(it.projectTitle);
        const inviterName = this.escapeHtml(it.inviterName);
        const invitedEmail = this.escapeHtml(it.invitedEmail);
        const acceptUrl = encodeURI(it.acceptUrl);
        return `
        <h1>${projectTitle}</h1>
        <p>Hi,</p>
        <p><strong>${inviterName}</strong> has invited you to join the project <strong>${projectTitle}</strong> on Lore.</p>
        <p>
          <a href="${acceptUrl}" style="display: inline-block; padding: 10px 20px; background-color: #4f46e5; color: white; text-decoration: none; border-radius: 6px;">
            Join ${projectTitle}
          </a>
        </p>
        <p>The invitation is bound to <strong>${invitedEmail}</strong>. If you already have a Lore account with that address, the link will take you to sign in.</p>
        <p>This invitation will expire in ${it.expiresInDays} days.</p>
      `;
      },
    },
    schema: z.object({
      projectTitle: z.string(),
      inviterName: z.string(),
      invitedEmail: z.string(),
      acceptUrl: z.string(),
      expiresInDays: z.number(),
    }),
  });

  protected onInvitationCreated = $hook({
    on: "invitation:created",
    handler: async ({ invitation, inviter, token }) => {
      try {
        const project = await this.projects.findOne({
          where: { id: { eq: Number(invitation.resourceId) } },
        });
        if (!project) {
          this.log.warn("Skipping invitation email — project not found", {
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
        // The register page reads `?invitation=`; see `AuthRegisterPage`.
        // `encodeURIComponent` because the token is `<uuid>.<uuid>` and a
        // future format change must not be able to smuggle a `&` into the
        // query string.
        const acceptUrl = `${baseUrl}/auth/register?invitation=${encodeURIComponent(token)}`;

        const inviterName = inviter.email
          ? inviter.email.includes("@")
            ? inviter.email.slice(0, inviter.email.indexOf("@"))
            : inviter.email
          : "A project owner";

        await this.invitationInvite.push({
          contact: invitation.email,
          variables: {
            projectTitle: project.title,
            inviterName,
            invitedEmail: invitation.email,
            acceptUrl,
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
