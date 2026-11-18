import { $inject } from "alepha";
import { $notification } from "alepha/api/notifications";

import { projectEventNotificationSchema } from "../schemas/projectEventNotificationSchema.ts";
import { LoreInboxNotifications } from "./LoreInboxNotifications.ts";
import { NotificationHtmlEscaper } from "./NotificationHtmlEscaper.ts";

/**
 * What a subscribed member receives when a project event happens (#Q3890):
 * the event's fixed message, one line in the inbox, a subject and a body
 * with the link by email. One template per channel, because a push cannot
 * select a template's channels. The member's own preferences (email off, a
 * muted category) still apply: the category is `notifications`.
 */
export class ProjectEventNotifications {
  public readonly lang = $inject(LoreInboxNotifications).lang;
  protected readonly escaper = $inject(NotificationHtmlEscaper);

  public readonly inbox = $notification({
    name: "lore:project-event:inbox",
    category: "notifications",
    description: "A project event you are notified of.",
    schema: projectEventNotificationSchema,
    inbox: {
      title: (it) => it.title,
      body: (it) => it.text,
      href: (it) => it.href,
      scope: (it) => it.scope,
      scopeLabel: (it) => it.projectTitle,
    },
  });

  public readonly email = $notification({
    name: "lore:project-event:email",
    category: "notifications",
    description: "A project event you are notified of.",
    schema: projectEventNotificationSchema,
    email: {
      subject: (it) => `${it.projectTitle}: ${it.title}`,
      body: (it) => {
        const project = this.escaper.escape(it.projectTitle);
        return `
        <p style="margin: 0 0 4px; color: #6b7280; font-size: 13px;">${project}</p>
        <h1 style="margin: 0 0 16px; font-size: 20px;">${this.escaper.escape(it.title)}</h1>
        <p style="margin: 0;">${this.escaper.escape(it.text)}</p>
        <p style="margin: 24px 0;">
          <a href="${this.escaper.escape(encodeURI(it.url))}" style="display: inline-block; padding: 10px 20px; background-color: #4f46e5; color: white; text-decoration: none; border-radius: 6px;">
            Open in Lore
          </a>
        </p>
        <p style="margin: 24px 0 0; padding-top: 12px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px;">You are notified of this in ${project}'s notification settings.</p>
      `;
      },
      text: (it) =>
        [
          it.text,
          "",
          `Open in Lore: ${it.url}`,
          "",
          `You are notified of this in ${it.projectTitle}'s notification settings.`,
        ].join("\n"),
    },
  });

  /**
   * A project's Discord channel (#Q3891): compact, bold title, the text, the
   * link. The destination is the channel the subscription names, unsealed
   * at send time by `LoreDiscordNotificationChannel`; mentions are off.
   */
  public readonly discord = $notification({
    name: "lore:project-event:discord",
    category: "notifications",
    description: "A project event posted to a Discord channel.",
    schema: projectEventNotificationSchema,
    discord: {
      message: (it) => `**${it.title}**\n${it.text}\n<${it.url}>`,
    },
  });
}
