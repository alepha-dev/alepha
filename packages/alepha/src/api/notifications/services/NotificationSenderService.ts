import { $inject, Alepha, AlephaError } from "alepha";
import { EmailProvider, EmailTextRenderer } from "alepha/email";
import { $logger } from "alepha/logger";
import { SmsProvider } from "alepha/sms";

import { $notification } from "../primitives/$notification.ts";
import { NotificationPreferenceProvider } from "../providers/NotificationPreferenceProvider.ts";
import type { NotificationPayload } from "../schemas/notificationPayloadSchema.ts";
import { NotificationAttachmentService } from "./NotificationAttachmentService.ts";
import { NotificationDeliveryService } from "./NotificationDeliveryService.ts";
import { NotificationSettings } from "./NotificationSettings.ts";
import { NotificationSuppressionService } from "./NotificationSuppressionService.ts";
import { NotificationUnsubscribeService } from "./NotificationUnsubscribeService.ts";

/**
 * What the caller knows about the delivery attempt that the payload does
 * not.
 */
export interface NotificationSendContext {
  /**
   * The job execution this send belongs to, which is what a delivery receipt
   * is keyed on. Absent when `send()` is called outside a job, in which case
   * no receipt is written.
   */
  executionId?: string;
}

type NotificationMessageEmail = {
  subject: string;
  body: string | ((variables: any) => string | Promise<string>);
  text?: string | ((variables: any) => string | Promise<string>);
};
type NotificationMessageSms = {
  message: string | ((variables: any) => string | Promise<string>);
};

export class NotificationSenderService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly emailProvider = $inject(EmailProvider);
  protected readonly smsProvider = $inject(SmsProvider);
  protected readonly textRenderer = $inject(EmailTextRenderer);
  protected readonly suppressions = $inject(NotificationSuppressionService);
  protected readonly preferences = $inject(NotificationPreferenceProvider);
  protected readonly unsubscribeTokens = $inject(
    NotificationUnsubscribeService,
  );
  protected readonly deliveries = $inject(NotificationDeliveryService);
  protected readonly settings = $inject(NotificationSettings);
  protected readonly attachmentService = $inject(NotificationAttachmentService);

  public async send(
    payload: NotificationPayload,
    context: NotificationSendContext = {},
  ) {
    this.log.debug("Processing notification", {
      type: payload.type,
      template: payload.template,
      contact: payload.contact,
    });

    // The gate, and the only one. It runs at SEND time rather than at push
    // time on purpose: a suppression can land in between, and the send-time
    // answer is the authoritative one.
    const skipped = await this.gate(payload);
    if (skipped) {
      // A skipped send is not a failure. Returning rather than throwing is
      // what makes the job row end `ok`, so retries never fight the gate and
      // a suppressed contact is not mailed on attempt two.
      this.log.info("Notification skipped", {
        type: payload.type,
        template: payload.template,
        contact: payload.contact,
        skipped,
      });
      await this.writeReceipt(context, payload, {
        status: "skipped",
        skipReason: skipped,
      });
      return { type: payload.type, to: payload.contact, skipped };
    }

    if (payload.type === "email") {
      const rendered = await this.renderEmail(payload);
      const result = await this.attempt(context, payload, () =>
        this.emailProvider.send(rendered),
      );
      this.log.info("Email notification sent", {
        template: payload.template,
        contact: payload.contact,
      });
      await this.writeReceipt(context, payload, {
        status: "sent",
        messageId: result.messageId ?? null,
        subject: rendered.subject,
        body: rendered.body,
      });
      return {
        type: "email" as const,
        to: rendered.to,
        subject: rendered.subject,
        body: rendered.body,
        messageId: result.messageId,
      };
    }

    if (payload.type === "sms") {
      const rendered = await this.renderSms(payload);
      await this.attempt(context, payload, () =>
        this.smsProvider.send(rendered),
      );
      this.log.info("SMS notification sent", {
        template: payload.template,
        contact: payload.contact,
      });
      await this.writeReceipt(context, payload, {
        status: "sent",
        subject: null,
      });
      return {
        type: "sms" as const,
        to: rendered.to,
        message: rendered.message,
      };
    }
  }

  /**
   * Run the provider call, and on a throw write a `failed` receipt before
   * rethrowing.
   *
   * The rethrow matters: the job must still record `error` and still retry.
   * Without the receipt, a failure would live only on the outbox row, which
   * is purged at 7 days while receipts live 90 - so the admin page would
   * keep every success for three months and lose every failure after a week,
   * which is the exact inverse of what an operator needs.
   */
  protected async attempt<R>(
    context: NotificationSendContext,
    payload: NotificationPayload,
    call: () => Promise<R>,
  ): Promise<R> {
    try {
      return await call();
    } catch (error) {
      await this.writeReceipt(context, payload, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Persist what happened, if we know which execution this is.
   *
   * ⚠️ **A receipt write must never be able to cause a re-send.** It happens
   * after the provider call, and a failure here is logged rather than
   * thrown: if it propagated, the job would retry and the message would go
   * out twice. A missing receipt is a reporting gap; a double send is a real
   * one.
   */
  protected async writeReceipt(
    context: NotificationSendContext,
    payload: NotificationPayload,
    outcome: {
      status: "sent" | "failed" | "skipped";
      messageId?: string | null;
      skipReason?: "suppressed" | "declined";
      subject?: string | null;
      body?: string | null;
      error?: string | null;
    },
  ): Promise<void> {
    if (!context.executionId) {
      // Called outside a job (a preview, a direct call). Nothing to key a
      // receipt on, and inventing an id would put rows in the operator's
      // list that no delivery corresponds to.
      return;
    }

    try {
      const sensitive = payload.sensitive === true;
      await this.deliveries.record({
        executionId: context.executionId,
        organizationId: payload.organizationId ?? null,
        messageId: outcome.messageId ?? null,
        provider: this.providerName(payload.type),
        channel: payload.type,
        contact: payload.contact,
        template: payload.template,
        category: payload.category ?? null,
        critical: payload.critical === true,
        status: outcome.status,
        skipReason: outcome.skipReason ?? null,
        // A subject can carry a name or an amount, so a sensitive template
        // stores neither it nor the body, the same rule `toDetailResource`
        // already applies to variables.
        subject: sensitive ? null : (outcome.subject ?? null),
        body:
          sensitive || !this.storeRenderedBody()
            ? null
            : (outcome.body ?? null),
        error: outcome.error ?? null,
      });
    } catch (error) {
      this.log.error("Failed to write the delivery receipt", {
        executionId: context.executionId,
        template: payload.template,
        error,
      });
    }
  }

  protected providerName(channel: "email" | "sms"): string {
    const provider =
      channel === "email" ? this.emailProvider : this.smsProvider;
    return provider.constructor.name;
  }

  /**
   * Whether to keep the rendered HTML on the receipt.
   *
   * Off by default: 90 days of full HTML for every notification is real
   * bytes on D1, and a fan-out over a roster multiplies it. Measure before
   * turning it on.
   */
  protected storeRenderedBody(): boolean {
    return this.settings.current.storeRenderedBody === true;
  }

  /**
   * Decide whether this message must not go out, and why.
   *
   * Suppression first, preferences second, and the order matters: an app's
   * preference provider can allow whatever it likes, but it can never
   * resurrect an address that bounced or complained.
   *
   * Returns undefined when the message may be sent.
   */
  protected async gate(
    payload: NotificationPayload,
  ): Promise<"suppressed" | "declined" | undefined> {
    const channel = payload.type;

    const suppressed = await this.suppressions.isSuppressed({
      contact: payload.contact,
      channel,
      // From the payload, never from `currentTenantAtom`: this runs inside a
      // job and there is no request to read a tenant from.
      organizationId: payload.organizationId,
      category: payload.category,
      critical: payload.critical,
    });
    if (suppressed) {
      return "suppressed";
    }

    const allowed = await this.preferences.allows({
      contact: payload.contact,
      channel,
      template: payload.template,
      category: payload.category,
      organizationId: payload.organizationId,
      critical: payload.critical,
    });
    if (!allowed) {
      return "declined";
    }

    return undefined;
  }

  public async renderSms(payload: NotificationPayload) {
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
        ? await sms.message(variables as any)
        : sms.message;

    return { to: contact, message };
  }

  public async renderEmail(payload: NotificationPayload) {
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
    // A critical template carries no unsubscribe link: there is nothing to
    // opt out of, and offering one would suggest a password reset can be
    // switched off. Undefined also when PUBLIC_URL is unset.
    const unsubscribeUrl = payload.critical
      ? undefined
      : this.unsubscribeTokens.urlFor({
          contact: contact,
          channel: "email",
          category: payload.category,
          template: payload.template,
          organizationId: payload.organizationId,
        });

    // The body sees it as one more variable, so an app can put a visible
    // link in its own footer. The framework never injects markup into a body
    // it does not own.
    const renderVariables = { ...(variables as object), unsubscribeUrl };

    const body =
      typeof email.body === "function"
        ? await email.body(renderVariables as any)
        : email.body;

    // A template's own text always wins. Deriving one when it is absent is
    // what gets every existing template a plain-text part without any of
    // them being rewritten, which is the whole point: an HTML-only message
    // scores worse with every spam filter.
    const declared =
      typeof email.text === "function"
        ? await email.text(renderVariables as any)
        : email.text;
    const text = declared ?? this.textRenderer.fromHtml(body);

    // Framework-set, never caller-set, so there is nothing for the header
    // policy to refuse here. It guards `$email.send()`, where the map does
    // come from a caller.
    const headers = unsubscribeUrl
      ? {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        }
      : undefined;

    // Bytes are fetched here and nowhere earlier. A missing object throws,
    // which fails the send rather than quietly delivering an invoice email
    // with no invoice.
    const attachments = await this.attachmentService.resolve(
      payload.attachments,
      { organizationId: payload.organizationId },
    );

    return { to: contact, subject, body, text, headers, attachments };
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
