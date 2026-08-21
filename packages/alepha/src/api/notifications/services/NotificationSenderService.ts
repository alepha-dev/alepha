import { $inject, Alepha, AlephaError } from "alepha";
import { EmailProvider } from "alepha/email";
import { $logger } from "alepha/logger";
import { SmsProvider } from "alepha/sms";

import { $notification } from "../primitives/$notification.ts";
import type { NotificationPayload } from "../schemas/notificationPayloadSchema.ts";

type NotificationMessageEmail = {
  subject: string;
  body: string | ((variables: any) => string);
};
type NotificationMessageSms = {
  message: string | ((variables: any) => string);
};

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
      const rendered = this.renderEmail(payload);
      await this.emailProvider.send(rendered);
      this.log.info("Email notification sent", {
        template: payload.template,
        contact: payload.contact,
      });
      return {
        type: "email" as const,
        to: rendered.to,
        subject: rendered.subject,
        body: rendered.body,
      };
    }

    if (payload.type === "sms") {
      const rendered = this.renderSms(payload);
      await this.smsProvider.send(rendered);
      this.log.info("SMS notification sent", {
        template: payload.template,
        contact: payload.contact,
      });
      return {
        type: "sms" as const,
        to: rendered.to,
        message: rendered.message,
      };
    }
  }

  public renderSms(payload: NotificationPayload) {
    const { variables, contact, template } = this.load(payload);

    const sms =
      this.translation(template.options, payload.lang)?.sms ??
      template.options.sms;
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

    const email =
      this.translation(template.options, payload.lang)?.email ??
      template.options.email;
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

  /**
   * Pick the template's `translations` entry for the payload language:
   * exact match ("fr-FR") first, then the base language ("fr"). Returns
   * undefined when there is no match — callers fall back to the default
   * (template-level) message.
   */
  protected translation(
    options: {
      translations?: Record<
        string,
        { email?: unknown; sms?: unknown } | undefined
      >;
    },
    lang?: string,
  ):
    | { email?: NotificationMessageEmail; sms?: NotificationMessageSms }
    | undefined {
    if (!lang || !options.translations) return undefined;
    const exact = options.translations[lang];
    if (exact) return exact as any;
    const base = lang.split("-")[0]?.toLowerCase();
    return base ? (options.translations[base] as any) : undefined;
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
