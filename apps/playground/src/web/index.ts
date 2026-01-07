import { AlephaUI } from "@alepha/ui";
import { $module } from "alepha";
import { AppRouter } from "./AppRouter.ts";

export const PlaygroundWeb = $module({
  name: "playground.web",
  services: [AlephaUI, AppRouter],
});
