import { $module } from "alepha";
import { CustomerController } from "./controllers/CustomerController.ts";

export const SaasCustomers = $module({
  name: "saas.api.customers",
  services: [CustomerController],
});
