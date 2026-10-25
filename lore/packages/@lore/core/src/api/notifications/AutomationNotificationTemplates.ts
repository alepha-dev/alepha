import { $inject } from "alepha";
import { $notification } from "alepha/api/notifications";

import { automationNotificationVariablesSchema } from "../schemas/automationNotificationVariablesSchema.ts";
import { LoreInboxNotifications } from "./LoreInboxNotifications.ts";

/**
 * One channel per template, because push cannot select a template's channels.
 * No optional transport is declared here. Prose was escaped once by the typed
 * renderer, while the subject and plain-text alternatives remain verbatim.
 */
export class AutomationNotificationTemplates {
  public readonly lang = $inject(LoreInboxNotifications).lang;
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
              body: (it) => it.html,
              text: (it) => it.text,
            }
          : undefined,
    });
  }
}
