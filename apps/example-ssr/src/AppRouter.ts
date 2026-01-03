import { $page } from "@alepha/react/router";
import { t } from "alepha";
import { $client } from "alepha/server/links";
import type { CountApi } from "./CountApi.ts";

export class AppRouter {
  countApi = $client<CountApi>();

  home = $page({
    schema: {
      query: t.object({
        name: t.text({ default: "Alepha" }),
      }),
    },
    resolve: async ({ query }) => {
      return {
        greeting: `Hello, ${query.name} SSR!`,
        count: await this.countApi.inc().then((result) => result.count),
      };
    },
    lazy: () => import("./Home.tsx"),
  });
}
