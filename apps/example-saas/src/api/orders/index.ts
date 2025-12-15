import { $module } from "alepha";
import { ProductOrderController } from "./controllers/ProductOrderController.ts";

export * from "./controllers/ProductOrderController.ts";
export * from "./entities/productOrders.ts";

export const SaasOrders = $module({
  name: "saas.orders",
  services: [ProductOrderController],
});
