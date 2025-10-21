import { $inject } from "@alepha/core";
import { $page } from "@alepha/react";
import { RootRouter } from "@alepha/ui";
import Home from "./components/Home.tsx";

export class AppRouter {
  rootRouter = $inject(RootRouter);

  home = $page({
    parent: this.rootRouter.root,
    path: "/",
    component: Home,
    head: {
      title: "Playground",
    },
  });
}
