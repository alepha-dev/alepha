import { $page } from "@alepha/react";
import { run, t } from "alepha";

class App {
  home = $page({
    schema: {
      query: t.object({
        name: t.text({ default: "Alepha" }),
      }),
    },
    resolve: ({ query }) => {
      return {
        greeting: `Hello, ${query.name} SSR!`,
      };
    },
    lazy: () => import("./Home.tsx"),
  });
}

run(App);
