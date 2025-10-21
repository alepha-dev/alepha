import { $module } from "@alepha/core";
import { AlephaReact } from "@alepha/react";
import { ToastService } from "./services/ToastService.tsx";

// ---------------------------------------------------------------------------------------------------------------------
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/nprogress/styles.css";
import "@mantine/spotlight/styles.css";
import "@mantine/notifications/styles.css";
import { RootRouter } from "./RootRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

export { Flex } from "@mantine/core";
export { default as Action } from "./components/Action.tsx";
export { default as AlephaMantineProvider } from "./components/AlephaMantineProvider.tsx";
export { default as Control } from "./components/Control.tsx";
export { default as DarkModeButton } from "./components/DarkModeButton.tsx";
export { default as Omnibar } from "./components/Omnibar.tsx";
export { default as TypeForm } from "./components/TypeForm.tsx";
export { useToast } from "./hooks/useToast.ts";
export * from "./RootRouter.ts";
export { ToastService } from "./services/ToastService.tsx";

// ---------------------------------------------------------------------------------------------------------------------

/**
 *
 *
 * @module alepha.ui
 */
export const AlephaUI = $module({
  name: "alepha.ui",
  services: [AlephaReact, ToastService, RootRouter],
});
