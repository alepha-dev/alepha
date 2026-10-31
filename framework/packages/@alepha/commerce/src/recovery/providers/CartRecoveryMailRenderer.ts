import type { PricedCartLine } from "../../cart/services/CartService.ts";
import type { RenderedMail } from "../../notifications/providers/OrderMailRenderer.ts";

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
 * Plain-text French defaults, matching the language of the package's other
 * customer-facing mails.
 */
export class DefaultCartRecoveryMailRenderer extends CartRecoveryMailRenderer {
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
    const footer = `\n\nPour ne plus recevoir ces rappels : ${unsubscribeUrl}`;

    if (stage === 1) {
      return {
        subject: "Votre panier vous attend",
        body: `Vous avez laissé ces articles dans votre panier :\n\n${items}\n\nIls sont toujours disponibles — finalisez votre commande quand vous voulez.${footer}`,
      };
    }

    return {
      subject: "Dernier rappel — votre panier expire bientôt",
      body: `Votre panier contient encore :\n\n${items}\n\nIl expirera prochainement. C'est le moment de finaliser votre commande.${footer}`,
    };
  }
}
