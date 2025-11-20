import { $page } from "@alepha/react";

export class RootRouter {
  public readonly root = $page({
    path: "/",
    lazy: () => import("./components/layout/AlephaMantineProvider.tsx"),
  });
}
