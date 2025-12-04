import { $module } from "alepha";
import { AppRouter } from "./AppRouter.ts";

export const ExampleSaasWeb = $module({
  name: "example-saas.web",
  services: [AppRouter],
});

export * from "./AppRouter.ts";
export * from "./atoms/bookingAtom.ts";
