import { $module } from "alepha";
import { AlephaReactUi } from "alepha/react/ui";

import { AppRouter } from "./AppRouter.ts";
import { CalculatorEngine } from "./services/CalculatorEngine.ts";

/**
 * The calculator's pages and its engine. There is no `AlephaReactAuth` and no
 * `$client`: an app that never calls an API never waits for one.
 */
export const WebModule = $module({
  name: "calculator.web",
  imports: [AlephaReactUi],
  services: [AppRouter, CalculatorEngine],
});
