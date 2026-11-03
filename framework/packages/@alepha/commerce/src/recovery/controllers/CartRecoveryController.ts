import { $inject, z } from "alepha";
import { $route } from "alepha/server";

import { CartRecoveryJobs } from "../services/CartRecoveryJobs.ts";
import { CartRecoveryService } from "../services/CartRecoveryService.ts";

/**
 * The unsubscribe link of a reminder.
 *
 * GET for the person clicking it, POST for the mail client behind the
 * `List-Unsubscribe-Post` header. Both do it at once: an opt-out that asks to be
 * confirmed is not one click, and the worst a link scanner can do here is spare
 * somebody a reminder. The token in the URL is the credential: the reminder is
 * the only place it was ever written.
 */
export class CartRecoveryController {
  protected readonly recovery = $inject(CartRecoveryService);
  protected readonly jobs = $inject(CartRecoveryJobs);

  public readonly commerceRecoveryUnsubscribe = $route({
    method: "GET",
    path: "/commerce/recovery/unsubscribe/:token",
    schema: { params: z.object({ token: z.text({ maxLength: 64 }) }) },
    handler: async ({ params }) => this.unsubscribe(params.token),
  });

  public readonly commerceRecoveryUnsubscribeOneClick = $route({
    method: "POST",
    path: "/commerce/recovery/unsubscribe/:token",
    schema: { params: z.object({ token: z.text({ maxLength: 64 }) }) },
    handler: async ({ params }) => this.unsubscribe(params.token),
  });

  protected async unsubscribe(token: string): Promise<string> {
    const { cartId } = await this.recovery.unsubscribe(token);
    await this.jobs.cartRecovery.cancelByKey(cartId, {
      cancelledBy: "system",
      cancelledByName: "unsubscribed",
    });
    return "Unsubscribed: no more reminders will be sent to this address.";
  }
}
