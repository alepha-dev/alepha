import { $module } from "alepha";
import { ProductController } from "./controllers/ProductController.ts";

export * from "./entities/products.ts";

export const SaasProducts = $module({
  name: "saas.products",
  services: [ProductController],
});
