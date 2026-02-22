import { $module } from "alepha";
import { linkOptionsAtom } from "alepha/server/links";
import { AppRouter } from "./AppRouter.ts";

export const WebModule = $module({
  name: "testadmin.web",
  services: [AppRouter],
  register: (alepha) => {
    alepha.with(AppRouter);
    alepha.set(linkOptionsAtom, {
      batch: true,
    });
  },
});
