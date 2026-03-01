import { $module } from "alepha";
import { AppRouter } from "./AppRouter.ts";

export const WebModule = $module({
  name: "uidemo.web",
  services: [AppRouter],
});
