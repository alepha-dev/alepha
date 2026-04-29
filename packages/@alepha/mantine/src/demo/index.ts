import { AlephaUI } from "@alepha/mantine";
import { $module } from "alepha";
import { DemoRouter } from "./DemoRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

export { DemoRouter } from "./DemoRouter.ts";
export * from "./primitives/$uiDemo.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
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
