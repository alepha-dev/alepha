import { $inject, Alepha, AlephaError } from "alepha";
import { EmailProvider } from "alepha/email";
import { $logger } from "alepha/logger";
import { SmsProvider } from "alepha/sms";
import { $notification } from "../primitives/$notification.ts";
import type { NotificationPayload } from "../schemas/notificationPayloadSchema.ts";

export class NotificationSenderService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly emailProvider = $inject(EmailProvider);
  protected readonly smsProvider = $inject(SmsProvider);

  public async send(payload: NotificationPayload) {
    this.log.debug("Processing notification", {
      type: payload.type,
      template: payload.template,
      contact: payload.contact,
    });

    if (payload.type === "email") {
      await this.emailProvider.send(this.renderEmail(payload));
      this.log.info("Email notification sent", {
        template: payload.template,
        contact: payload.contact,
      });
    }

    if (payload.type === "sms") {
      await this.smsProvider.send(this.renderSms(payload));
      this.log.info("SMS notification sent", {
        template: payload.template,
        contact: payload.contact,
      });
    }
  }

  public renderSms(payload: NotificationPayload) {
    const { variables, contact, template } = this.load(payload);

    const sms = template.options.sms;
    if (!sms) {
      throw new AlephaError(
        `Notification template ${payload.template} has no sms defined`,
      );
    }

    const message =
      typeof sms.message === "function"
        ? sms.message(variables as any)
        : sms.message;

    return { to: contact, message };
  }

  public renderEmail(payload: NotificationPayload) {
    const { variables, contact, template } = this.load(payload);

    const email = template.options.email;
    if (!email) {
      throw new AlephaError(
        `Notification template ${payload.template} has no email defined`,
      );
    }

    const subject = email.subject;
    const body =
      typeof email.body === "function"
        ? email.body(variables as any)
        : email.body;

    return { to: contact, subject, body };
  }

  protected load(payload: NotificationPayload) {
    const variables = payload.variables || {};
    const contact = payload.contact;
    const template = this.alepha
      .primitives($notification)
      .find((it) => it.name === payload.template);

    if (!template) {
      throw new AlephaError(
        `No notification template found for ${payload.template}`,
      );
    }

    return { template, variables, contact };
  }
}
