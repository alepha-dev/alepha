import { $page } from "@alepha/react";
import AlephaMantineProvider from "./components/layout/AlephaMantineProvider.tsx";

export class RootRouter {
  public readonly root = $page({
    path: "/",
    component: AlephaMantineProvider,
  });
}
