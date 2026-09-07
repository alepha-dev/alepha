import { $inject, Alepha, AlephaError } from "alepha";
import { $logger } from "alepha/logger";

import type {
  NotificationChannel,
  NotificationRendered,
} from "../channels/NotificationChannel.ts";
import { $notification } from "../primitives/$notification.ts";
import { NotificationPreferenceProvider } from "../providers/NotificationPreferenceProvider.ts";
import type { NotificationPayload } from "../schemas/notificationPayloadSchema.ts";
import { NotificationChannelService } from "./NotificationChannelService.ts";
import { NotificationDeliveryService } from "./NotificationDeliveryService.ts";
import { NotificationSettings } from "./NotificationSettings.ts";
import { NotificationSuppressionService } from "./NotificationSuppressionService.ts";

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

export class NotificationSenderService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly channels = $inject(NotificationChannelService);
  protected readonly suppressions = $inject(NotificationSuppressionService);
  protected readonly preferences = $inject(NotificationPreferenceProvider);
  protected readonly deliveries = $inject(NotificationDeliveryService);
  protected readonly settings = $inject(NotificationSettings);

  public async send(
    payload: NotificationPayload,
    context: NotificationSendContext = {},
  ) {
    this.log.debug("Processing notification", {
      type: payload.type,
      template: payload.template,
      contact: payload.contact,
    });

    // One path, whatever the channel. The only thing the sender knows about
    // a channel is the contract: it renders, it sends, and it says who it
    // reached. Everything below is channel-agnostic by construction, which
    // is what makes a plugin's channel a first-class one rather than a
    // second branch nobody maintains.
    const channel = this.channels.require(payload.type);

    // ⚠️ **Addressable channels only.** A sink fires at a destination named
    // in the template: there is nobody to suppress, nothing to opt out of
    // and no unsubscribe token to mint. Running the gate on a destination
    // string would let a bounce on somebody's address silence an ops alert,
    // and a suppression row spelled `discord:alerts` would be indelible.
    //
    // The gate itself runs at SEND time rather than at push time on purpose:
    // a suppression can land in between, and the send-time answer is the
    // authoritative one.
    if (channel.addressable) {
      const contact = this.requireContact(payload, channel.channel);
      const skipped = await this.gate(payload, contact);
      if (skipped) {
        // A skipped send is not a failure. Returning rather than throwing is
        // what makes the job row end `ok`, so retries never fight the gate
        // and a suppressed contact is not mailed on attempt two.
        this.log.info("Notification skipped", {
          type: payload.type,
          template: payload.template,
          contact,
          skipped,
        });
        await this.writeReceipt(context, payload, {
          status: "skipped",
          skipReason: skipped,
          recipient: contact,
        });
        return { type: payload.type, to: contact, skipped };
      }
    }

    // ⚠️ **Every channel, addressable or not**, and deliberately its own
    // receipt write rather than a branch folded into the gate above: the
    // gate is suppression plus preferences, which a sink must never get.
    // A sink can still be misconfigured, so it is asked the same question.
    //
    // This runs before `render()` because that is the whole point. `render()`
    // is called outside `attempt()`, so a channel that throws there writes no
    // receipt and the job retries a contact that will never resolve.
    const unavailable = await channel.unavailable(payload);
    if (unavailable) {
      this.log.info("Notification unavailable", {
        type: payload.type,
        template: payload.template,
        contact: unavailable.recipient,
        reason: unavailable.reason,
      });
      await this.writeReceipt(context, payload, {
        status: "skipped",
        skipReason: "unavailable",
        recipient: unavailable.recipient,
        error: unavailable.reason,
      });
      return {
        type: payload.type,
        to: unavailable.recipient,
        skipped: "unavailable" as const,
      };
    }

    const rendered = await channel.render(this.renderInput(payload, channel));
    const result = await this.attempt(
      context,
      payload,
      rendered.recipient,
      () => channel.send(rendered),
    );

    this.log.info("Notification sent", {
      channel: channel.channel,
      template: payload.template,
      contact: rendered.recipient,
    });

    await this.writeReceipt(context, payload, {
      status: "sent",
      messageId: result.messageId ?? null,
      subject: rendered.subject ?? null,
      body: rendered.body ?? null,
      recipient: rendered.recipient,
    });

    return {
      type: payload.type,
      to: rendered.recipient,
      subject: rendered.subject,
      body: rendered.body,
      messageId: result.messageId,
    };
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
    recipient: string,
    call: () => Promise<R>,
  ): Promise<R> {
    try {
      return await call();
    } catch (error) {
      await this.writeReceipt(context, payload, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        recipient,
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
      skipReason?: "suppressed" | "declined" | "unavailable";
      subject?: string | null;
      body?: string | null;
      error?: string | null;
      /**
       * Who or where the message went, straight from the channel.
       *
       * Required, and never reconstructed from the payload: an addressable
       * channel returns the address it was given, a sink returns
       * `discord:releases`, and the receipt's `contact` column is NOT NULL
       * for both. Every call site has one, including the skip path, where
       * the gate has already established the contact.
       */
      recipient: string;
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
        contact: outcome.recipient,
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

  /**
   * What the receipt records as the provider.
   *
   * Asked of the channel, so a receipt keeps naming the transport that
   * actually sent the message (`BrevoEmailProvider`) rather than the adapter
   * over it. Falls back to the channel name rather than throwing: this runs
   * inside {@link writeReceipt}, where a throw costs the receipt.
   */
  protected providerName(channel: string): string {
    return this.channels.find(channel)?.providerName() ?? channel;
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
    contact: string,
  ): Promise<"suppressed" | "declined" | undefined> {
    const channel = payload.type;

    const suppressed = await this.suppressions.isSuppressed({
      contact,
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
      contact,
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

  /**
   * Re-render one notification without sending it.
   *
   * The admin preview is the caller. It returns the contract's base fields
   * only, which is also what keeps a plugin's secrets out of a preview
   * response: a sink carries its resolved webhook in its own channel-private
   * `R`, and nothing here looks past {@link NotificationRendered}.
   */
  public async render(
    payload: NotificationPayload,
  ): Promise<NotificationRendered> {
    const channel = this.channels.require(payload.type);
    return channel.render(this.renderInput(payload, channel));
  }

  /**
   * Everything a channel needs to render, resolved from the payload.
   *
   * Translation resolution stays here rather than moving into the channels:
   * picking `translations["fr"]` is channel-agnostic, and every channel
   * would otherwise reimplement the same two-step fallback.
   */
  protected renderInput(
    payload: NotificationPayload,
    channel: NotificationChannel<any, any>,
  ) {
    const { variables, template } = this.load(payload);
    const key = channel.channel;

    const message =
      this.translation(template.options, payload.lang)?.[key] ??
      (template.options as Record<string, any>)[key];

    if (!message) {
      throw new AlephaError(
        `Notification template ${payload.template} has no ${key} defined`,
      );
    }

    return { message, variables, payload };
  }

  /**
   * Pick the template's `translations` entry for the payload language:
   * exact match ("fr-FR") first, then the base language ("fr"). Returns
   * undefined when there is no match — callers fall back to the default
   * (template-level) message.
   */
  protected translation(
    options: { translations?: Record<string, object | undefined> },
    lang?: string,
  ): Record<string, any> | undefined {
    if (!lang || !options.translations) return undefined;
    const exact = options.translations[lang];
    if (exact) return exact as any;
    const base = lang.split("-")[0]?.toLowerCase();
    return base ? (options.translations[base] as any) : undefined;
  }

  /**
   * The contact an addressable channel is about to write to.
   *
   * `push()` makes this unreachable through the type system unless every
   * channel the template declares is a sink. It is still checked here,
   * because a payload can be built by hand (an admin resend, a row queued by
   * an older version), and sending to `undefined` is worse than failing.
   */
  protected requireContact(
    payload: NotificationPayload,
    channel: string,
  ): string {
    const contact = payload.contact;
    if (!contact) {
      throw new AlephaError(
        `Notification "${payload.template}" has no contact, which channel "${channel}" needs.`,
      );
    }
    return contact;
  }

  protected load(payload: NotificationPayload) {
    const variables = payload.variables || {};
    const template = this.alepha
      .primitives($notification)
      .find((it) => it.name === payload.template);

    if (!template) {
      throw new AlephaError(
        `No notification template found for ${payload.template}`,
      );
    }

    return { template, variables };
  }
}
