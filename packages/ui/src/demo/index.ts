import { AlephaUI } from "@alepha/ui";
import { $module } from "alepha";
import { DemoRouter } from "./DemoRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

export { DemoRouter } from "./DemoRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | type | quality | stability |
 * |------|---------|-----------|
 * | frontend | standard | experimental |
 *
 * Component showcase and documentation.
 *
 * **Features:**
 * - DemoLayout for demo pages
 * - DemoHome landing page
 * - MacWindow component for showcases
 * - Showcase component for component demos
 *
 * @module alepha.ui.demo
 */
export const AlephaUIDemo = $module({
  name: "alepha.ui.demo",
  services: [AlephaUI, DemoRouter],
});
