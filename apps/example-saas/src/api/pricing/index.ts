import { $module } from "alepha";
import { PricingController } from "./controllers/PricingController.ts";
import { PricingService } from "./services/PricingService.ts";

export { PricingService } from "./services/PricingService.ts";

export const SaasPricing = $module({
  name: "saas.api.pricing",
  services: [PricingService, PricingController],
});
