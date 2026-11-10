import { $notification } from "alepha/api/notifications";

import { automationAttentionVariablesSchema } from "../schemas/automationAttentionVariablesSchema.ts";

/**
 * Lore telling an author that one of their automations stopped and needs
 * them (#Q3267).
 *
 * Not one of `AutomationNotificationTemplates`: those carry a rule's own
 * output, rendered by the rule and marked sensitive. This is Lore's message
 * about the rule, with fixed wording.
 *
 * Inbox only. The rule is not running, which matters the next time its
 * author opens Lore and not at the minute it happened.
 */
export class AutomationAttentionNotifications {
  public readonly attention = $notification({
    name: "lore:automation:attention",
    category: "automations",
    description:
      "Filed in an automation author's header bell when their rule pauses for their approval, or breaks. Links to the rule.",
    schema: automationAttentionVariablesSchema,
    inbox: {
      title: (it) =>
        it.kind === "approval"
          ? `${it.automationTitle} is paused until you review it`
          : `${it.automationTitle} is broken`,
      body: (it) => it.reason,
      href: (it) => it.href,
      scope: (it) => it.scope,
      scopeLabel: (it) => it.projectTitle,
    },
    translations: {
      fr: {
        inbox: {
          title: (it) =>
            it.kind === "approval"
              ? `${it.automationTitle} est en pause jusqu'à votre validation`
              : `${it.automationTitle} est en panne`,
          body: (it) => it.reason,
          href: (it) => it.href,
          scope: (it) => it.scope,
          scopeLabel: (it) => it.projectTitle,
        },
      },
    },
  });
}
