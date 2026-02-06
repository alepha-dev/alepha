import { $module } from "alepha";
import { AppSecurity } from "./AppSecurity.ts";
import { HelloController } from "./controllers/HelloController.ts";

export const ApiModule = $module({
  name: "blogmantine.api",
  services: [AppSecurity, HelloController],
});
