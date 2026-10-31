import { $inject } from "alepha";

import type { OrderItemEntity } from "../../entities/orderItems.ts";
import type { OrderEntity } from "../../entities/orders.ts";
import type { OrderDownload } from "../../providers/OrderDownloadsProvider.ts";
import { CommerceTexts } from "../../services/CommerceTexts.ts";

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
 * sends. The default below is deliberately plain prose in the shop's language,
 * from `CommerceTexts`: correct, complete, and obviously meant to be replaced:
 *
 * ```ts
 * alepha.with({ provide: OrderMailRenderer, use: AtelierAuroreMails });
 * ```
 */
export abstract class OrderMailRenderer {
  /**
   * @param downloads what the buyer can collect now, for an order with digital
   *   lines.
   */
  abstract confirmation(
    order: OrderEntity,
    items: OrderItemEntity[],
    downloads?: OrderDownload[],
  ): Promise<RenderedMail>;

  abstract shipped(order: OrderEntity): Promise<RenderedMail>;
}

/**
 * Plain, correct order emails, in the shop's language.
 *
 * Includes the statutory fourteen-day withdrawal notice on the confirmation,
 * because that is the message a distance seller must give the buyer and the
 * confirmation is where it belongs.
 */
export class DefaultOrderMailRenderer extends OrderMailRenderer {
  protected readonly texts = $inject(CommerceTexts);

  public async confirmation(
    order: OrderEntity,
    items: OrderItemEntity[],
    downloads: OrderDownload[] = [],
  ): Promise<RenderedMail> {
    const lines = items
      .map(
        (item) =>
          `<li>${this.escape(item.name)}${
            item.variantLabel ? ` (${this.escape(item.variantLabel)})` : ""
          } × ${item.quantity} - ${this.money(
            item.unitPrice * item.quantity - item.discount,
            order.currency,
          )}</li>`,
      )
      .join("");

    const t = (key: string, ...args: string[]) => this.texts.t(key, ...args);
    const reference = this.reference(order);

    return {
      subject: t("mail.confirmation.subject", reference),
      body: `<p>${t("mail.confirmation.thanks", reference)}</p>
<ul>${lines}</ul>
${
  order.discountTotal > 0
    ? `<p>${t("mail.confirmation.discount", this.money(order.discountTotal, order.currency))}</p>`
    : ""
}
${
  order.shippingTotal > 0
    ? `<p>${t("mail.confirmation.delivery", this.money(order.shippingTotal, order.currency))}</p>`
    : ""
}
<p><strong>${t("mail.confirmation.total", this.money(order.total, order.currency))}</strong></p>
${
  downloads.length > 0
    ? `<p>${t("mail.confirmation.downloads")}</p><ul>${downloads
        .map(
          (it) =>
            `<li><a href="${this.escape(it.url)}">${this.escape(it.name)}</a></li>`,
        )
        .join("")}</ul>`
    : ""
}
<p>${t("mail.confirmation.next")}</p>
<hr>
<p style="font-size:12px;color:#555">${t("mail.confirmation.withdrawal")}</p>`,
    };
  }

  public async shipped(order: OrderEntity): Promise<RenderedMail> {
    const t = (key: string, ...args: string[]) => this.texts.t(key, ...args);

    return {
      subject: t("mail.shipped.subject", this.reference(order)),
      body: `<p>${t("mail.shipped.body")}</p>
${
  order.trackingNumber
    ? `<p>${t("mail.shipped.tracking", `<strong>${this.escape(order.trackingNumber)}</strong>`)}</p>`
    : ""
}
${
  order.trackingUrl
    ? `<p><a href="${this.escape(order.trackingUrl)}">${t("mail.shipped.follow")}</a></p>`
    : ""
}`,
    };
  }

  /**
   * The order's number, with its leading space, or nothing on an order older
   * than the column.
   */
  protected reference(order: OrderEntity): string {
    return order.number ? ` ${order.number}` : "";
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
