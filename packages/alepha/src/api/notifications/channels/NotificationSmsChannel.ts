import { $inject } from "alepha";
import { SmsProvider } from "alepha/sms";

import type { NotificationChannels } from "../primitives/$notification.ts";
import {
  NotificationChannel,
  type NotificationRendered,
  type NotificationRenderInput,
} from "./NotificationChannel.ts";

/**
 * The `sms` block of a template, with its translation already applied.
 */
export type NotificationSmsMessage = NonNullable<
  NotificationChannels<any>["sms"]
>;

/**
 * What the sms channel hands to its transport.
 */
export interface NotificationSmsRendered extends NotificationRendered {
  to: string;
  body: string;
}

/**
 * SMS, as the second implementation of the channel contract.
 *
 * Registered by default in `AlephaApiNotifications`' `services[]`, so an app
 * that declares an `sms` block changes nothing to get it.
 */
export class NotificationSmsChannel extends NotificationChannel<
  NotificationSmsMessage,
  NotificationSmsRendered
> {
  protected readonly smsProvider = $inject(SmsProvider);

  public readonly channel = "sms";
  public readonly addressable = true;

  /**
   * The transport's class name, for the same reason the email channel
   * reports its own: a receipt names what actually sent the message.
   */
  public override providerName(): string {
    return this.smsProvider.constructor.name;
  }

  public async render(
    input: NotificationRenderInput<NotificationSmsMessage>,
  ): Promise<NotificationSmsRendered> {
    const { message: sms, variables, payload } = input;

    const body =
      typeof sms.message === "function"
        ? await sms.message(variables as any)
        : sms.message;

    return { recipient: payload.contact, to: payload.contact, body };
  }

  public async send(rendered: NotificationSmsRendered) {
    // The sms transports report nothing about a message they accepted, so
    // there is no id to carry into the receipt.
    await this.smsProvider.send({ to: rendered.to, message: rendered.body });
    return {};
  }
}
