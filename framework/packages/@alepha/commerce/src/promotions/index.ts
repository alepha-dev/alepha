import { $module } from "alepha";

import { AlephaCommerceCart } from "../cart/index.ts";
import { CartDiscountProvider } from "../cart/providers/CartDiscountProvider.ts";
import { AdminPromotionController } from "./controllers/AdminPromotionController.ts";
import { PromotionDiscountSource } from "./providers/PromotionDiscountSource.ts";
import { PromotionService } from "./services/PromotionService.ts";

export * from "./controllers/AdminPromotionController.ts";
export * from "./entities/promotionRedemptions.ts";
export * from "./entities/promotions.ts";
export * from "./providers/PromotionDiscountSource.ts";
export * from "./services/PromotionService.ts";

/**
 * Discount codes and automatic discounts.
 *
 * Importing it is the whole integration: it plugs into the cart's
 * `CartDiscountProvider`, and carts start earning discounts. A discount lowers
 * the tax-inclusive line totals, so VAT is computed on what is paid, and the
 * order and the invoice freeze it.
 *
 * Imports the cart and not the checkout, though checkout is what reads it:
 * importing the checkout would wire it here, and `shipping`, which substitutes
 * into it, would then come too late.
 *
 * @module alepha.commerce.promotions
 */
export const AlephaCommercePromotions = $module({
  name: "alepha.commerce.promotions",
  imports: [AlephaCommerceCart],
  services: [
    PromotionService,
    PromotionDiscountSource,
    AdminPromotionController,
  ],
  register: (alepha) => {
    alepha
      .inject(CartDiscountProvider)
      .use(alepha.inject(PromotionDiscountSource));
  },
});
