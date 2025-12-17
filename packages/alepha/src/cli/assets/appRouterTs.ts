export const appRouterTs = () => `
import { $page } from "@alepha/react";

export class AppRouter {
  home = $page({
    component: () => "Hello World",
  });
}
`.trim();
