import { $page } from "alepha/react/router";

import { Home } from "./components/Home.tsx";

export class AppRouter {
  home = $page({
    path: "/",
    component: Home,
  });
}
