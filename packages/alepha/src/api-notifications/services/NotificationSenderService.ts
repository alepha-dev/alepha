import { $inject, Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { EmailProvider } from "alepha/email";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
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
    this.log.trace("Sending notification", {
      notificationId:
        typeof notificationId === "string" ? notificationId : notificationId.id,
    });

    const notification =
      typeof notificationId === "string"
        ? await this.notificationRepository.findById(notificationId)
        : notificationId;

    if (notification.sentAt) {
      this.log.debug("Notification already sent", {
        notificationId: notification.id,
        sentAt: notification.sentAt,
      });
      return;
    }

    this.log.debug("Processing notification", {
      id: notification.id,
      type: notification.type,
      template: notification.template,
      contact: notification.contact,
    });

    try {
      if (notification.type === "email") {
        await this.emailProvider.send(this.renderEmail(notification));
        notification.sentAt = this.dateTimeProvider.nowISOString();
        this.log.info("Email notification sent", {
          id: notification.id,
          template: notification.template,
          contact: notification.contact,
        });
      }
      if (notification.type === "sms") {
        await this.smsProvider.send(this.renderSms(notification));
        notification.sentAt = this.dateTimeProvider.nowISOString();
        this.log.info("SMS notification sent", {
          id: notification.id,
          template: notification.template,
          contact: notification.contact,
        });
      }
    } catch (e) {
      this.log.error("Failed to send notification", {
        id: notification.id,
        type: notification.type,
        template: notification.template,
        contact: notification.contact,
        error: e,
      });
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
    this.log.trace("Rendering SMS notification", {
      id: notification.id,
      template: notification.template,
    });

    const { variables, contact, template } = this.load(notification);

    const sms = template.options.sms;
    if (!sms) {
      this.log.error("Notification template has no SMS defined", {
        id: notification.id,
        template: notification.template,
      });
      throw new AlephaError(
        `Notification template ${notification.template} has no sms defined`,
      );
    }

    this.log.debug("Rendering SMS", {
      template: notification.template,
      contact,
    });

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
    this.log.trace("Rendering email notification", {
      id: notification.id,
      template: notification.template,
    });

    const { variables, contact, template } = this.load(notification);

    const email = template.options.email;
    if (!email) {
      this.log.error("Notification template has no email defined", {
        id: notification.id,
        template: notification.template,
      });
      throw new AlephaError(
        `Notification template ${notification.template} has no email defined`,
      );
    }

    this.log.debug("Rendering email", {
      template: notification.template,
      contact,
      subject: email.subject,
    });

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
      this.log.error("Notification template not found", {
        id: notification.id,
        template: notification.template,
      });
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
