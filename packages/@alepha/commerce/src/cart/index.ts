import { $module } from "alepha";

import { AlephaCommerce } from "../index.ts";
import { CartController } from "./controllers/CartController.ts";
import { CartService } from "./services/CartService.ts";

export * from "./controllers/CartController.ts";
export * from "./entities/cartItems.ts";
export * from "./entities/carts.ts";
export * from "./services/CartService.ts";

/**
 * Server-side baskets.
 *
 * A separate module because a consumer can genuinely not want it: a
 * point-of-sale builds an order at the counter and never has a basket to
 * persist, and shipping two unused tables into its migrations would be a cost
 * with no return.
 *
 * @module alepha.commerce.cart
 */
export const AlephaCommerceCart = $module({
  name: "alepha.commerce.cart",
  imports: [AlephaCommerce],
  services: [CartService, CartController],
});
