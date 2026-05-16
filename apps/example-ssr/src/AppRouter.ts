import { t } from "alepha";
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";
import type { CountApi } from "./CountApi.ts";

export class AppRouter {
  countApi = $client<CountApi>();

  home = $page({
    head: {
      title: "Home",
    },
    schema: {
      query: t.object({
        name: t.text({ default: "Alepha" }),
      }),
    },
    loader: async ({ query }) => {
      return {
        greeting: `Hello, ${query.name} SSR!`,
        count: await this.countApi.inc().then((result) => result.count),
      };
    },
    lazy: () => import("./Home.tsx"),
  });

  about = $page({
    head: {
      title: "About",
    },
    path: "/about",
    lazy: () => import("./About.tsx"),
  });
}
