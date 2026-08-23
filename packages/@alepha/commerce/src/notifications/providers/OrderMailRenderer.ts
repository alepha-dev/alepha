import type { OrderItemEntity } from "../../entities/orderItems.ts";
import type { OrderEntity } from "../../entities/orders.ts";

/**
 * A rendered email, ready to send.
 */
export interface RenderedMail {
  subject: string;
  body: string;
}

/**
 * Writes the customer-facing order emails.
 *
 * Abstract because these two messages are the most brand-sensitive text a shop
 * sends, and a framework has no business deciding their wording or their
 * language. The default below is deliberately plain French prose — correct,
 * complete, and obviously meant to be replaced:
 *
 * ```ts
 * alepha.with({ provide: OrderMailRenderer, use: AtelierAuroreMails });
 * ```
 */
export abstract class OrderMailRenderer {
  abstract confirmation(
    order: OrderEntity,
    items: OrderItemEntity[],
  ): Promise<RenderedMail>;

  abstract shipped(order: OrderEntity): Promise<RenderedMail>;
}

/**
 * Plain, correct order emails in French.
 *
 * Includes the statutory fourteen-day withdrawal notice on the confirmation,
 * because that is the message a distance seller must give the buyer and the
 * confirmation is where it belongs.
 */
export class DefaultOrderMailRenderer extends OrderMailRenderer {
  public async confirmation(
    order: OrderEntity,
    items: OrderItemEntity[],
  ): Promise<RenderedMail> {
    const lines = items
      .map(
        (item) =>
          `<li>${this.escape(item.name)} × ${item.quantity} — ${this.money(
            item.unitPrice * item.quantity,
            order.currency,
          )}</li>`,
      )
      .join("");

    return {
      subject: `Votre commande est confirmée`,
      body: `<p>Merci, nous avons bien reçu votre commande et votre paiement.</p>
<ul>${lines}</ul>
${
  order.shippingTotal > 0
    ? `<p>Livraison : ${this.money(order.shippingTotal, order.currency)}</p>`
    : ""
}
<p><strong>Total réglé : ${this.money(order.total, order.currency)}</strong></p>
<p>Vous recevrez un second message dès que votre colis partira.</p>
<hr>
<p style="font-size:12px;color:#555">
  Vous disposez de quatorze jours à compter de la réception pour exercer votre
  droit de rétractation, sans avoir à motiver votre décision.
</p>`,
    };
  }

  public async shipped(order: OrderEntity): Promise<RenderedMail> {
    return {
      subject: `Votre commande est en route`,
      body: `<p>Votre colis a été confié au transporteur.</p>
${
  order.trackingNumber
    ? `<p>Numéro de suivi : <strong>${this.escape(order.trackingNumber)}</strong></p>`
    : ""
}
${
  order.trackingUrl
    ? `<p><a href="${this.escape(order.trackingUrl)}">Suivre mon colis</a></p>`
    : ""
}`,
    };
  }

  protected money(cents: number, currency: string): string {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }

  protected escape(value: string): string {
    return value.replace(/[&<>"']/g, (c) =>
      c === "&"
        ? "&amp;"
        : c === "<"
          ? "&lt;"
          : c === ">"
            ? "&gt;"
            : c === '"'
              ? "&quot;"
              : "&#39;",
    );
  }
}
