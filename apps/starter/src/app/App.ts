import { $module } from "alepha";
import { AlephaReactHead } from "@alepha/react/head";
import { AppI18n } from "./AppI18n.ts";
import { AppRouter } from "./AppRouter.ts";

export const App = $module({
  name: "my.app",
  services: [AlephaReactHead, AppRouter, AppI18n],
});
