export interface WebAppRouterTsOptions {
  /**
   * The saas preset: the pages sit under `components/Layout.tsx`, which
   * mounts `DialogProvider`. That is where `@alepha/ui` draws its settings
   * dialogs, the account dialog among them, so without it the account has
   * nowhere to open.
   */
  saas?: boolean;
}

export const webAppRouterTs = (options: WebAppRouterTsOptions = {}) => {
  if (options.saas) {
    return `import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";

import type { HelloController } from "../api/controllers/HelloController.ts";

export class AppRouter {
  api = $client<HelloController>();

  layout = $page({
    lazy: () => import("./components/Layout.tsx"),
    children: (): any[] => [this.home],
  });

  home = $page({
    path: "/",
    lazy: () => import("./components/Home.tsx"),
    loader: () => this.api.hello(),
  });
}
`;
  }
  return `import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";

import type { HelloController } from "../api/controllers/HelloController.ts";

export class AppRouter {
  api = $client<HelloController>();

  home = $page({
    path: "/",
    lazy: () => import("./components/Home.tsx"),
    loader: () => this.api.hello(),
  });
}
`;
};
