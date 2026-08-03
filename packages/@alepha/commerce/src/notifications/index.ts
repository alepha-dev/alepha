import { $module } from "alepha";
import { AlephaEmail } from "alepha/email";
import { AlephaCommerceCheckout } from "../checkout/index.ts";
import {
  DefaultOrderMailRenderer,
  OrderMailRenderer,
} from "./providers/OrderMailRenderer.ts";
import { OrderMailer } from "./services/OrderMailer.ts";

export * from "./providers/OrderMailRenderer.ts";
export * from "./services/OrderMailer.ts";

/**
 * The two customer-facing order emails: confirmation and shipping notice.
 *
 * A separate module because a point-of-sale sends neither — it hands over a
 * receipt across a counter — and because the wording is brand-sensitive enough
 * that many consumers will want to replace it wholesale:
 *
 * ```ts
 * alepha.with({ provide: OrderMailRenderer, use: MyMails });
 * ```
 *
 * @module alepha.commerce.notifications
 */
export const AlephaCommerceNotifications = $module({
  name: "alepha.commerce.notifications",
  imports: [AlephaCommerceCheckout, AlephaEmail],
  services: [OrderMailRenderer, OrderMailer],
  variants: [DefaultOrderMailRenderer],
  register: (alepha) => {
    alepha.with({
      optional: true,
      provide: OrderMailRenderer,
      use: DefaultOrderMailRenderer,
    });
  },
});
