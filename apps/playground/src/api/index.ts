import { $module } from "alepha";
import { AppSecurity } from "./AppSecurity.ts";

export const PlaygroundApi = $module({
  name: "playground.api",
  services: [AppSecurity],
});
