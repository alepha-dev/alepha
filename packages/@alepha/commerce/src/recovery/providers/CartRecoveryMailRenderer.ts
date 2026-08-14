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
  abstract reminder(
    stage: 1 | 2,
    lines: PricedCartLine[],
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
  ): Promise<RenderedMail> {
    const items = lines.map((l) => `- ${l.name} × ${l.quantity}`).join("\n");

    if (stage === 1) {
      return {
        subject: "Votre panier vous attend",
        body: `Vous avez laissé ces articles dans votre panier :\n\n${items}\n\nIls sont toujours disponibles — finalisez votre commande quand vous voulez.`,
      };
    }

    return {
      subject: "Dernier rappel — votre panier expire bientôt",
      body: `Votre panier contient encore :\n\n${items}\n\nIl expirera prochainement. C'est le moment de finaliser votre commande.`,
    };
  }
}
