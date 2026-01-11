import { $page } from "@alepha/react/router";
import { t } from "alepha";
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
    schema: {
      query: t.object({
        hack: t.optional(t.string()),
      }),
    },
    resolve: ({ query }) => {
      return query;
    },
  });

  about = $page({
    path: "/about",
    component: () => "about",
  });
}
