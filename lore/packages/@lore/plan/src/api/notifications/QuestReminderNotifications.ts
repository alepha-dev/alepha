import {
  LoreInboxNotifications,
  NotificationHtmlEscaper,
} from "@lore/core/api";
import { $inject } from "alepha";
import { $notification } from "alepha/api/notifications";

import { questReminderNotificationSchema } from "../schemas/questReminderNotificationSchema.ts";

/**
 * A quest reminder, told to the quest's assignee directly (#Q3893), like
 * every personal notification: in the inbox, and by email unless their
 * settings say otherwise (category `tasks`).
 */
export class QuestReminderNotifications {
  public readonly lang = $inject(LoreInboxNotifications).lang;
  protected readonly escaper = $inject(NotificationHtmlEscaper);

  public readonly inbox = $notification({
    name: "lore:quest:reminder-inbox",
    category: "tasks",
    description: "A reminder of a quest you hold.",
    schema: questReminderNotificationSchema,
    inbox: {
      title: (it) => `Reminder: ${it.reference} ${it.title}`,
      body: () => "This quest is still yours and still open.",
      href: (it) => it.href,
      scope: (it) => it.scope,
      scopeLabel: (it) => it.projectTitle,
    },
  });

  public readonly email = $notification({
    name: "lore:quest:reminder-email",
    category: "tasks",
    description: "A reminder of a quest you hold.",
    schema: questReminderNotificationSchema,
    email: {
      subject: (it) => `Reminder: ${it.reference} ${it.title}`,
      body: (it) =>
        `<p>${this.escaper.escape(it.reference)} ${this.escaper.escape(it.title)} is still yours and still open, in ${this.escaper.escape(it.projectTitle)}.</p><p><a href="${this.escaper.escape(encodeURI(it.url))}">Open it in Lore</a></p>`,
      text: (it) =>
        `${it.reference} ${it.title} is still yours and still open, in ${it.projectTitle}.\n\nOpen it in Lore: ${it.url}`,
    },
  });
}
