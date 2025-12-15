import { $module } from "alepha";
import { AdmRouter } from "./AdmRouter.ts";

export * from "./AdmRouter.ts";

export const SaasAdm = $module({
  name: "saas.adm",
  services: [AdmRouter],
});
