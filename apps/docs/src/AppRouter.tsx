import { $page, NotFound } from "@alepha/react";
import { t } from "alepha";
import { NotFoundError } from "alepha/server";
import Content from "./components/Content.tsx";
import Home from "./components/Home.tsx";
import Layout from "./components/Layout.tsx";
import { docs } from "./config/docs.ts";

declare module "@alepha/react" {
  interface PageDescriptorOptions {
    sidebar?: boolean;
  }
}

export class AppRouter {
  layout = $page({
    component: Layout,
    children: () => [this.home, this.m, this.github404, this.notFound],
    head: {
      title: "Alepha",
      titleSeparator: " | ",
    },
  });

  home = $page({
    path: "/",
    component: Home,
    label: "Home",
    static: true,
    head: {
      title: "Home",
    },
  });

  m = $page({
    sidebar: true,
    path: "/docs/:slug",
    component: Content,
    schema: {
      params: t.object({
        slug: t.text(),
      }),
    },
    static: {
      entries: docs.map((it) => ({
        params: { slug: it.slug },
        label: it.name,
      })),
    },
    resolve: async ({ params }) => {
      for (const pkg of docs) {
        if (pkg.slug === params.slug) {
          return { ...pkg, content: await pkg.content() };
        }
      }
      throw new NotFoundError();
    },
    head: ({ name }) => {
      return {
        title: name,
      };
    },
  });

  github404 = $page({
    path: "/404",
    static: true,
    component: () => <NotFound />,
  });

  notFound = $page({
    path: "/*",
    component: () => <NotFound />,
  });
}
