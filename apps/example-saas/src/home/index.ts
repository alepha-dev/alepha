import { $module } from "alepha";
import { HomeRouter } from "./HomeRouter.ts";

export * from "./HomeRouter.ts";

export const SaasHome = $module({
  name: "saas.home",
  services: [HomeRouter],
});
