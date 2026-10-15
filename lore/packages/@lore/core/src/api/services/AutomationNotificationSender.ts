import {
  NotificationSenderService,
  type NotificationPayload,
  type NotificationSendContext,
} from "alepha/api/notifications";
import { $repository, DbEntityNotFoundError } from "alepha/orm";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "alepha/server";

import { users } from "../entities/users.ts";
import { automationNotificationVariablesSchema } from "../schemas/automationNotificationVariablesSchema.ts";
import { AutomationAuthority } from "./AutomationAuthority.ts";
import { AutomationCatalog } from "./AutomationCatalog.ts";
import { AutomationChannels } from "./AutomationChannels.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { CoreAutomationReferences } from "./CoreAutomationReferences.ts";

/**
 * Deferred outbox work rechecks the author and the actual recipient before
 * disclosing data. Other notifications retain the framework's send path.
 */
export class AutomationNotificationSender extends NotificationSenderService {
  protected readonly automationUsers = $repository(users);
  public override async send(
    payload: NotificationPayload,
    context: NotificationSendContext = {},
  ) {
    if (payload.variables?.automationId === undefined)
      return super.send(payload, context);
    return this.alepha
      .inject(AutomationDatabase)
      .primary(() => this.sendAutomation(payload, context));
  }
  protected async sendAutomation(
    payload: NotificationPayload,
    context: NotificationSendContext,
  ) {
    try {
      const variables = automationNotificationVariablesSchema.parse(
        payload.variables,
      );
      const stored = await this.alepha
        .inject(AutomationPersistence)
        .rules.getById(variables.automationId);
      const sourceKey =
        stored.rule.trigger.kind === "event"
          ? stored.rule.trigger.event
          : stored.rule.select!.key;
      const source = this.alepha
        .inject(AutomationCatalog)
        .entries()
        .find((entry) => entry.key === sourceKey);
      if (source) {
        const reason = await this.alepha
          .inject(CoreAutomationReferences)
          .recipientReason(stored.projectId, variables.recipientUserId, source);
        if (reason) throw new ForbiddenError(reason);
      }
      const current = await this.alepha.inject(AutomationAuthority).check({
        automationId: variables.automationId,
        revision: variables.ruleRevision,
        effect: {
          index: variables.actionIndex,
          action: {
            kind: "notify",
            recipient: variables.recipientUserId,
            channel: payload.type,
            title: variables.title,
            text: variables.text,
            category: variables.category,
          },
        },
      });
      const adapter = await this.alepha
        .inject(AutomationChannels)
        .adapter(current.rule.projectId, payload.type);
      if (payload.template !== adapter.templates[variables.category])
        throw new ForbiddenError("Automation notification template changed");
      const account = await this.automationUsers.getById(
        variables.recipientUserId,
      );
      if (adapter.addressable) {
        const contact =
          payload.type === "inbox" && !account.email
            ? `lore-user:${account.id}`
            : account.email?.trim().toLowerCase();
        if (!contact || payload.contact !== contact)
          throw new ForbiddenError("Automation recipient contact changed");
      }
    } catch (error) {
      if (
        !(
          error instanceof ForbiddenError ||
          error instanceof ConflictError ||
          error instanceof BadRequestError ||
          error instanceof NotFoundError ||
          error instanceof DbEntityNotFoundError
        )
      )
        throw error;
      await this.writeReceipt(context, payload, {
        status: "skipped",
        skipReason: "unavailable",
        recipient: payload.contact ?? `${payload.type}:configured`,
      });
      return {
        type: payload.type,
        to: payload.contact ?? `${payload.type}:configured`,
        skipped: "unavailable" as const,
      };
    }
    return super.send(payload, context);
  }
}
