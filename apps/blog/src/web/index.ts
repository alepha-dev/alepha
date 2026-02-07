import { AlephaUI } from "@alepha/ui";
import { AdminRouter } from "@alepha/ui/admin";
import { $module } from "alepha";
import { AppRouter } from "./AppRouter.ts";

export const WebModule = $module({
  name: "blogmantine.web",
  services: [AppRouter],
  register: (alepha) => {
    alepha.with(AlephaUI);
    alepha.inject(AdminRouter);
    alepha.inject(AppRouter);
  },
});
