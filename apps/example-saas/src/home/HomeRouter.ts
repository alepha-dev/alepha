import { $page } from "@alepha/react";
import { AlephaMantineProvider } from "@alepha/ui";

export class HomeRouter {
  layout = $page({
    component: AlephaMantineProvider,
  });

  home = $page({
    parent: this.layout,
    path: "/",
    lazy: () => import("./components/Home.tsx"),
  });
}
