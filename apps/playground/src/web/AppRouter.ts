import { $page } from "@alepha/react/router";
import Home from "./Home.tsx";
import { Layout } from "./Layout.tsx";

export class AppRouter {
  layout = $page({
    component: Layout,
    children: () => [this.home, this.about],
  });

  home = $page({
    path: "/",
    component: Home,
  });

  about = $page({
    path: "/about",
    component: () => "about",
  });
}
