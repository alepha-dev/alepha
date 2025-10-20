import { $module } from "@alepha/core";
import { AlephaReact } from "@alepha/react";

// ---------------------------------------------------------------------------------------------------------------------
import "@mantine/core/styles.css";
import "@mantine/nprogress/styles.css";
import "@mantine/spotlight/styles.css";
import "@mantine/notifications/styles.css";

// ---------------------------------------------------------------------------------------------------------------------

export { default as Action } from "./components/Action";
export { default as AlephaMantineProvider } from "./components/AlephaMantineProvider.tsx";
export { default as Control } from "./components/Control";

// ---------------------------------------------------------------------------------------------------------------------

/**
 *
 *
 * @module alepha.ui
 */
export const AlephaUI = $module({
  name: "alepha.ui",
  services: [AlephaReact],
});
