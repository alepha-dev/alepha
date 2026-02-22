import { $module } from "alepha";
import { AppSecurity } from "./AppSecurity.ts";
import { HelloController } from "./controllers/HelloController.ts";

export const ApiModule = $module({
  name: "testadmin.api",
  services: [AppSecurity, HelloController],
});
