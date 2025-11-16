import { $page } from "@alepha/react";
import { RootRouter } from "@alepha/ui";
import { $inject } from "alepha";
import { $client } from "alepha/server/links";
import type { Api } from "./Api.ts";
import Home from "./components/Home.tsx";

export class AppRouter {
  rootRouter = $inject(RootRouter);
  api = $client<Api>();

  home = $page({
    parent: this.rootRouter.root,
    path: "/",
    component: Home,
    head: {
      title: "Playground",
    },
    resolve: async () => {
      return await this.api.ping();
    },
  });
}
