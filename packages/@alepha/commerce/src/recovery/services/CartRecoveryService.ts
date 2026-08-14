import { $inject } from "alepha";
import { $email } from "alepha/email";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { CartService } from "../../cart/services/CartService.ts";
import { checkoutSessions } from "../../checkout/entities/checkoutSessions.ts";
import { CartRecoveryMailRenderer } from "../providers/CartRecoveryMailRenderer.ts";

/**
 * The step bodies of the cart-recovery workflow, kept on a service so
 * they stay individually testable and substitutable.
 */
export class CartRecoveryService {
  protected readonly log = $logger();
  protected readonly carts = $inject(CartService);
  protected readonly renderer = $inject(CartRecoveryMailRenderer);
  protected readonly sessions = $repository(checkoutSessions);

  protected readonly reminderMail = $email({ name: "commerce-cart-recovery" });

  /**
   * Whether the cart still needs chasing: an open or paying session with
   * an email on file. A completed session (converted) or an abandoned one
   * ends the sequence.
   */
  public async isRecoverable(cartId: string): Promise<boolean> {
    const session = await this.sessions.findOne({
      where: {
        cartId: { eq: cartId },
        status: { inArray: ["open", "paying"] },
      },
    });
    return Boolean(session?.email);
  }

  /**
   * Send reminder `stage` for the cart. Returns `false` when there is
   * nothing left to remind about (cart emptied since). Throws on SMTP
   * failure so the workflow step can retry.
   */
  public async sendReminder(cartId: string, stage: 1 | 2): Promise<boolean> {
    const session = await this.sessions.findOne({
      where: {
        cartId: { eq: cartId },
        status: { inArray: ["open", "paying"] },
      },
    });
    if (!session?.email) {
      return false;
    }

    const priced = await this.carts.price(cartId);
    if (priced.lines.length === 0) {
      return false;
    }

    const mail = await this.renderer.reminder(stage, priced.lines);
    await this.reminderMail.send({ to: session.email, ...mail });
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
