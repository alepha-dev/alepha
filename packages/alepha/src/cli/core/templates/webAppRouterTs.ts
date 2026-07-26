export const webAppRouterTs = () => {
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
}`;
};
