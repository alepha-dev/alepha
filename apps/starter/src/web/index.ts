import { AlephaReactHead } from "@alepha/react/head";
import { $module } from "alepha";
import { AppI18n } from "./AppI18n.ts";
import { AppRouter } from "./AppRouter.ts";

export const StarterWeb = $module({
  name: "starter.app",
  services: [AlephaReactHead, AppRouter, AppI18n],
});
