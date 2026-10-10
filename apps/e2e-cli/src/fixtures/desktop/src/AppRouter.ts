import { z } from "alepha";
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";

import type { CountApi } from "./CountApi.ts";

export class AppRouter {
  countApi = $client<CountApi>();

  home = $page({
    head: {
      title: "Desktop fixture",
    },
    schema: {
      query: z.object({
        name: z.text({ default: "Alepha" }),
      }),
    },
    loader: async ({ query }) => {
      return {
        greeting: `Hello, ${query.name} desktop!`,
        count: await this.countApi.inc().then((result) => result.count),
      };
    },
    lazy: () => import("./Home.tsx"),
  });
}
