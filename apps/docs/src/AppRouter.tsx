import { $page, NotFound } from "@alepha/react";
import { $head } from "@alepha/react/head";
import { t } from "alepha";
import { NotFoundError } from "alepha/server";
import Docs from "./components/Docs.tsx";
import Home from "./components/Home.tsx";
import Layout from "./components/layout/Layout.tsx";
import { docs } from "./config/docs.ts";

declare module "@alepha/react" {
  interface PagePrimitiveOptions {
    sidebar?: boolean;
  }
}

export class AppRouter {
  head = $head({
    title: "Alepha",
    titleSeparator: " | ",
    description:
      "Alepha is a TypeScript-first framework with React SSR, schema validation, and modern backend tools. Build production-ready apps in days, not months.",
    image: "https://alepha.dev/og-image.png",
    url: "https://alepha.dev/",
    siteName: "Alepha",
    locale: "en_US",
    type: "website",
    imageWidth: 1200,
    imageHeight: 630,
    imageAlt: "Alepha Framework - TypeScript Made Easy",
    og: {
      title: "Alepha - TypeScript Framework Made Easy",
    },
    twitter: {
      card: "summary_large_image",
      title: "Alepha - TypeScript Framework Made Easy",
    },
  });

  layout = $page({
    component: Layout,
    children: () => [this.home, this.m, this.github404, this.notFound],
  });

  home = $page({
    path: "/",
    component: Home,
    label: "Home",
    static: true,
  });

  m = $page({
    sidebar: true,
    path: "/docs/:slug",
    component: Docs,
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
