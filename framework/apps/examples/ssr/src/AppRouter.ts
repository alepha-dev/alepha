import { z } from "alepha";
import { $page } from "alepha/react/router";
import { $sitemap } from "alepha/react/sitemap";
import { isHttpError, NotFoundError } from "alepha/server";
import { $client } from "alepha/server/links";
import { createElement } from "react";

import type { CountApi } from "./CountApi.ts";

export class AppRouter {
  countApi = $client<CountApi>();

  sitemap = $sitemap({ hostname: "https://example-ssr.alepha.dev" });

  home = $page({
    head: {
      title: "Home",
    },
    // The loader counts every view: a page that writes is not content the
    // page cache may serve again (#E78).
    cache: false,
    schema: {
      query: z.object({
        name: z.text({ default: "Alepha" }),
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

  /**
   * A deferred value: the page paints and answers clicks at once, and `slow`
   * lands in its `<Suspense>` `ms` milliseconds later.
   */
  deferred = $page({
    head: {
      title: "Deferred",
    },
    path: "/deferred",
    schema: {
      query: z.object({
        ms: z.integer().default(500),
        fail: z.boolean().default(false),
      }),
    },
    loader: async ({ query }) => {
      return {
        title: "Deferred shell",
        slow: new Promise<string>((resolve, reject) => {
          setTimeout(() => {
            if (query.fail) {
              reject(new NotFoundError("No such value"));
            } else {
              resolve("Deferred value");
            }
          }, query.ms);
        }),
      };
    },
    errorHandler: (error) => {
      if (isHttpError(error, 404)) {
        return createElement("p", { id: "failed" }, error.message);
      }
    },
    lazy: () => import("./Deferred.tsx"),
  });

  /**
   * Rendered in the browser only (`ssr: false`): the document a
   * client-rendered page gets, which the e2e suite runs under the CSP.
   */
  clientRendered = $page({
    head: {
      title: "Client rendered",
    },
    path: "/client-rendered",
    ssr: false,
    loader: async () => ({ message: "Rendered in the browser" }),
    lazy: () => import("./ClientRendered.tsx"),
  });

  about = $page({
    head: {
      title: "About",
    },
    path: "/about",
    lazy: () => import("./About.tsx"),
  });
}
