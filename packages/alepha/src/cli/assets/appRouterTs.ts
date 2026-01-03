export const appRouterTs = () => `
import { $page } from "@alepha/react/router";

export class AppRouter {
  home = $page({
    component: () => "Hello World",
  });
}
`.trim();
