import { $inject, type Infer } from "alepha";
import { $notification } from "alepha/api/notifications";

import { automationNotificationVariablesSchema } from "../schemas/automationNotificationVariablesSchema.ts";
import { LoreInboxNotifications } from "./LoreInboxNotifications.ts";
import { NotificationHtmlEscaper } from "./NotificationHtmlEscaper.ts";

/**
 * One channel per template, because push cannot select a template's channels.
 * No optional transport is declared here. Prose was escaped once by the typed
 * renderer, while the subject and plain-text alternatives remain verbatim.
 */
export class AutomationNotificationTemplates {
  public readonly lang = $inject(LoreInboxNotifications).lang;
  protected readonly escaper = $inject(NotificationHtmlEscaper);
  public readonly inbox = this.template(
    "lore:automation:inbox",
    "inbox",
    "automations",
  );
  public readonly email = this.template(
    "lore:automation:email",
    "email",
    "automations",
  );
  public readonly releaseInbox = this.template(
    "lore:automation:release-inbox",
    "inbox",
    "releases",
  );
  public readonly releaseEmail = this.template(
    "lore:automation:release-email",
    "email",
    "releases",
  );
  public readonly reminderInbox = this.template(
    "lore:automation:reminder-inbox",
    "inbox",
    "tasks",
  );
  public readonly reminderEmail = this.template(
    "lore:automation:reminder-email",
    "email",
    "tasks",
  );

  protected template(
    name: string,
    channel: "inbox" | "email",
    category: string,
  ) {
    return $notification({
      name,
      category,
      sensitive: true,
      description: "Output from an authorized project automation.",
      schema: automationNotificationVariablesSchema,
      inbox:
        channel === "inbox"
          ? {
              title: (it) => it.title,
              body: (it) => it.text,
              href: (it) => it.href,
              scope: (it) => it.scope,
              scopeLabel: (it) => it.projectTitle,
            }
          : undefined,
      email:
        channel === "email"
          ? {
              subject: (it) => it.title,
              body: (it) => this.body(it),
              text: (it) => this.text(it),
            }
          : undefined,
    });
  }

  /**
   * The rendered prose framed like Lore's other emails: the project, the
   * title, the text, a button to what it is about, and a footer naming the
   * automation that sent it (#Q3541). `html` is already escaped by the typed
   * renderer; the title and project are verbatim, so they are escaped here.
   */
  protected body(it: AutomationNotificationVariables): string {
    const project = this.escaper.escape(it.projectTitle);
    const title = this.escaper.escape(it.title);
    const button = it.url
      ? `
        <p style="margin: 24px 0;">
          <a href="${this.escaper.escape(encodeURI(it.url))}" style="display: inline-block; padding: 10px 20px; background-color: #4f46e5; color: white; text-decoration: none; border-radius: 6px;">
            Open in Lore
          </a>
        </p>`
      : "";
    const manage = it.manageUrl
      ? ` <a href="${this.escaper.escape(encodeURI(it.manageUrl))}" style="color: #6b7280;">Manage this automation</a>`
      : "";
    return `
        <p style="margin: 0 0 4px; color: #6b7280; font-size: 13px;">${project}</p>
        <h1 style="margin: 0 0 16px; font-size: 20px;">${title}</h1>
        ${it.html}${button}
        <p style="margin: 24px 0 0; padding-top: 12px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px;">Sent by an automation in ${project}.${manage}</p>
      `;
  }

  protected text(it: AutomationNotificationVariables): string {
    const lines = [it.text];
    if (it.url && !it.text.includes(it.url))
      lines.push("", `Open in Lore: ${it.url}`);
    lines.push("", `Sent by an automation in ${it.projectTitle}.`);
    if (it.manageUrl) lines.push(`Manage it: ${it.manageUrl}`);
    return lines.join("\n");
  }
}

type AutomationNotificationVariables = Infer<
  typeof automationNotificationVariablesSchema
>;
