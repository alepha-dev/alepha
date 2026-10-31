import { $inject } from "alepha";

import type { PricedCartLine } from "../../cart/services/CartService.ts";
import type { RenderedMail } from "../../notifications/providers/OrderMailRenderer.ts";
import { CommerceTexts } from "../../services/CommerceTexts.ts";

/**
 * Writes the abandoned-cart reminder emails.
 *
 * Substitutable for the same reason as `OrderMailRenderer`: the wording is
 * brand-sensitive, and a shop that runs this sequence at all will usually
 * want its own voice.
 */
export abstract class CartRecoveryMailRenderer {
  /**
   * @param unsubscribeUrl where the buyer leaves. A renderer MUST put it in the
   *   message: the headers carry it too, but not every mail client shows them.
   */
  abstract reminder(
    stage: 1 | 2,
    lines: PricedCartLine[],
    unsubscribeUrl: string,
  ): Promise<RenderedMail>;
}

/**
 * Plain-text defaults in the shop's language, like the package's other
 * customer-facing mails.
 */
export class DefaultCartRecoveryMailRenderer extends CartRecoveryMailRenderer {
  protected readonly texts = $inject(CommerceTexts);

  public async reminder(
    stage: 1 | 2,
    lines: PricedCartLine[],
    unsubscribeUrl: string,
  ): Promise<RenderedMail> {
    const items = lines
      .map(
        (l) =>
          `- ${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ""} × ${l.quantity}`,
      )
      .join("\n");
    const footer = this.texts.t("reminder.unsubscribe", unsubscribeUrl);
    const name = stage === 1 ? "reminder.first" : "reminder.second";

    return {
      subject: this.texts.t(`${name}.subject`),
      body: `${this.texts.t(`${name}.body`, items)}\n\n${footer}`,
    };
  }
}
