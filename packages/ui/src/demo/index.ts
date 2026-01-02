import { AlephaUI } from "@alepha/ui";
import { $module } from "alepha";
import { DemoRouter } from "./DemoRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

export { default as DemoHome } from "./components/DemoHome.tsx";
export { default as DemoLayout } from "./components/DemoLayout.tsx";
export { default as DemoJsonViewer } from "./components/json/DemoJsonViewer.tsx";
export {
  default as MacWindow,
  type MacWindowProps,
} from "./components/shared/MacWindow.tsx";
export {
  default as Showcase,
  type ShowcaseProps,
} from "./components/shared/Showcase.tsx";
export { DemoRouter } from "./DemoRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Demo UI Module - Component showcase and documentation
 *
 * @module alepha.ui.demo
 */
export const AlephaUIDemo = $module({
  name: "alepha.ui.demo",
  services: [AlephaUI, DemoRouter],
});
