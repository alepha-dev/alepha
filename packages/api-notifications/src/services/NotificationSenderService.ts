import { $inject, Alepha, AlephaError } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { EmailProvider } from "@alepha/email";
import { $logger } from "@alepha/logger";
import { $repository } from "@alepha/postgres";
import { $notification } from "../descriptors/$notification.ts";
import {
  type NotificationEntity,
  notifications,
} from "../entities/notifications.ts";
import { SmsProvider } from "../providers/SmsProvider.ts";

export class NotificationSenderService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly notificationRepository = $repository(notifications);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly emailProvider = $inject(EmailProvider);
  protected readonly smsProvider = $inject(SmsProvider);

  public async send(notificationId: string | NotificationEntity) {
    const notification =
      typeof notificationId === "string"
        ? await this.notificationRepository.findById(notificationId)
        : notificationId;

    if (notification.sentAt) {
      this.log.info(`Notification already sent`, {
        notificationId: notification.id,
      });
      return;
    }

    try {
      if (notification.type === "email") {
        await this.emailProvider.send(this.renderEmail(notification));
        notification.sentAt = this.dateTimeProvider.nowISOString();
      }
      if (notification.type === "sms") {
        await this.smsProvider.send(this.renderSms(notification));
      }
    } catch (e) {
      this.log.error("Failed to process notification", e);
      if (e instanceof Error) {
        notification.error = {
          at: this.dateTimeProvider.nowISOString(),
          name: e.name,
          message: e.message,
        };
      }
    } finally {
      await this.notificationRepository.save(notification);
    }
  }

  public renderSms(notification: NotificationEntity) {
    const { variables, contact, template } = this.load(notification);

    const sms = template.options.sms;
    if (!sms) {
      throw new AlephaError(
        `Notification template ${notification.template} has no sms defined`,
      );
    }

    this.log.debug(
      `Rendering sms for template ${notification.template} to ${contact}`,
      { variables },
    );

    const message =
      typeof sms.message === "function"
        ? sms.message(variables as any)
        : sms.message;

    return {
      to: contact,
      message,
    };
  }

  public renderEmail(notification: NotificationEntity) {
    const { variables, contact, template } = this.load(notification);

    const email = template.options.email;
    if (!email) {
      throw new AlephaError(
        `Notification template ${notification.template} has no email defined`,
      );
    }

    this.log.debug(
      `Rendering email for template ${notification.template} to ${contact}`,
      { variables },
    );

    const subject = email.subject;

    const body =
      typeof email.body === "function"
        ? email.body(variables as any)
        : email.body;

    return {
      to: contact,
      subject,
      body,
    };
  }

  protected load(notification: NotificationEntity) {
    const variables = notification.variables || {};
    const contact = notification.contact;
    const template = this.alepha
      .descriptors($notification)
      .find((it) => it.name === notification.template);

    if (!template) {
      throw new AlephaError(
        `No notification template found for ${notification.template}`,
      );
    }

    return {
      template,
      variables,
      contact,
    };
  }
}
