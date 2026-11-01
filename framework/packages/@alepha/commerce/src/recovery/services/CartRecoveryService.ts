import { $inject, $store } from "alepha";
import { $email } from "alepha/email";
import { $logger } from "alepha/logger";
import { $repository, DbConflictError } from "alepha/orm";
import { NotFoundError } from "alepha/server";

import { CartService } from "../../cart/services/CartService.ts";
import {
  type CheckoutSessionEntity,
  checkoutSessions,
} from "../../checkout/entities/checkoutSessions.ts";
import { cartRecoveryConfig } from "../cartRecoveryConfigAtom.ts";
import { recoveryOptOuts } from "../entities/recoveryOptOuts.ts";
import { CartRecoveryMailRenderer } from "../providers/CartRecoveryMailRenderer.ts";

/**
 * The stage bodies of the cart-recovery job, kept on a service so they
 * stay individually testable and substitutable.
 */
export class CartRecoveryService {
  protected readonly log = $logger();
  protected readonly carts = $inject(CartService);
  protected readonly renderer = $inject(CartRecoveryMailRenderer);
  protected readonly sessions = $repository(checkoutSessions);
  protected readonly optOuts = $repository(recoveryOptOuts);
  protected readonly config = $store(cartRecoveryConfig);

  protected readonly reminderMail = $email({ name: "commerce-cart-recovery" });

  /**
   * The session this cart may be chased through: open or paying, with an email,
   * with the buyer's consent on record, and an address that has not opted out.
   * Anything else ends the sequence.
   */
  protected async chaseable(
    cartId: string,
  ): Promise<CheckoutSessionEntity | undefined> {
    const session = await this.sessions.findOne({
      where: {
        cartId: { eq: cartId },
        status: { inArray: ["open", "paying"] },
      },
    });
    if (
      !session?.email ||
      !session.recoveryConsentAt ||
      (await this.hasOptedOut(session.email))
    ) {
      return undefined;
    }
    return session;
  }

  public async isRecoverable(cartId: string): Promise<boolean> {
    return Boolean(await this.chaseable(cartId));
  }

  public async hasOptedOut(email: string): Promise<boolean> {
    const found = await this.optOuts.count({
      email: { eq: email.trim().toLowerCase() },
    });
    return found > 0;
  }

  /**
   * Keep an address off every later reminder. Idempotent.
   */
  public async optOut(email: string): Promise<void> {
    try {
      await this.optOuts.create({ email: email.trim().toLowerCase() });
    } catch (error) {
      if (!(error instanceof DbConflictError)) {
        throw error;
      }
    }
  }

  /**
   * Act on an unsubscribe link: the address behind the token leaves the list,
   * and the caller stands the running sequence down.
   *
   * @throws NotFoundError for a token no reminder carried
   */
  public async unsubscribe(token: string): Promise<CheckoutSessionEntity> {
    const session = await this.sessions.findOne({
      where: { recoveryToken: { eq: token } },
    });
    if (!session?.email) {
      throw new NotFoundError("No such reminder.");
    }
    await this.optOut(session.email);
    this.log.info("Address opted out of cart reminders", {
      sessionId: session.id,
    });
    return session;
  }

  /**
   * Send reminder `stage` for the cart. Returns `false` when there is
   * nothing left to remind about (cart emptied since). Throws on SMTP
   * failure so the job can retry.
   */
  public async sendReminder(cartId: string, stage: 1 | 2): Promise<boolean> {
    const session = await this.chaseable(cartId);
    if (!session?.email || !session.recoveryToken) {
      return false;
    }

    const priced = await this.carts.price(cartId);
    if (priced.lines.length === 0) {
      return false;
    }

    const unsubscribeUrl = `${this.config.baseUrl}/commerce/recovery/unsubscribe/${session.recoveryToken}`;
    const mail = await this.renderer.reminder(
      stage,
      priced.lines,
      unsubscribeUrl,
    );
    await this.reminderMail.send({
      to: session.email,
      ...mail,
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    return true;
  }

  /**
   * Close the sequence: the buyer never came back, mark the session
   * abandoned so the funnel numbers say so.
   */
  public async markAbandoned(cartId: string): Promise<void> {
    const session = await this.sessions.findOne({
      where: {
        cartId: { eq: cartId },
        status: { inArray: ["open", "paying"] },
      },
    });
    if (!session) {
      return;
    }
    await this.sessions.updateById(session.id, { status: "abandoned" });
    this.log.info("Checkout marked abandoned after the recovery sequence", {
      cartId,
      sessionId: session.id,
    });
  }
}
