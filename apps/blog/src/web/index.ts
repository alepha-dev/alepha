import { AlephaUI } from "@alepha/ui";
import { $module } from "alepha";
import { AppRouter } from "./AppRouter.ts";

export const WebModule = $module({
  name: "blog.web",
  services: [AppRouter],
  register: (alepha) => {
    alepha.with(AlephaUI);
    alepha.inject(AppRouter);
  },
});
