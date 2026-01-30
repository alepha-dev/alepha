import { $page } from "alepha/react/router";
import AlephaMantineProvider from "./components/layout/AlephaMantineProvider.tsx";

/**
 * UI Router defining the root page with AlephaMantineProvider.
 *
 * - Use UiRouter when you need Alepha's Mantine-based UI components and theming.
 * - Prefer to use $ui() for convenience. (Custom Factory of UiRouter)
 */
export class UiRouter {
  public readonly root = $page({
    path: "/",
    component: AlephaMantineProvider,
  });
}
