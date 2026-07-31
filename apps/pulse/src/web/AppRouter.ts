import { $page } from "alepha/react/router";

export class AppRouter {
  home = $page({
    path: "/",
    name: "home",
    head: { title: "Pulse" },
    lazy: () => import("./components/HomePage.tsx"),
  });
}
