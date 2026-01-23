import { $head, type Head } from "@alepha/react/head";
import { $page, NotFound } from "@alepha/react/router";
import { $env, t } from "alepha";
import { HttpError, NotFoundError } from "alepha/server";
import Changelog from "./components/Changelog.tsx";
import Docs from "./components/Docs.tsx";
import Home from "./components/Home.tsx";
import Layout from "./components/layout/Layout.tsx";
import { changelog, docs } from "./config/docs.ts";

declare module "@alepha/react/router" {
  interface PagePrimitiveOptions {
    sidebar?: boolean;
  }
}

export class AppRouter {
  env = $env(
    t.object({
      UMAMI_URL: t.optional(t.string()),
      UMAMI_UUID: t.optional(t.string()),
    }),
  );

  head = $head(() => {
    const ogTitle = "Alepha Framework - TypeScript Made Easy";
    const head: Head = {
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
      imageAlt: ogTitle,
      og: {
        title: ogTitle,
      },
      twitter: {
        card: "summary_large_image",
        title: ogTitle,
      },
      script: [
        `
          var stored = localStorage.getItem('alepha-docs-mode');
          var theme = stored === 'light' ? 'light' : 'dark';
          document.documentElement.setAttribute('data-theme', theme);
        `.trim(),
      ],
      link: [
        {
          rel: "icon",
          type: "image/png",
          href: "/favicon.png",
        },
        {
          rel: "manifest",
          href: "/manifest.json",
        },
        {
          rel: "apple-touch-icon",
          href: "/apple-touch-icon.png",
        },
      ],
      meta: [
        {
          name: "theme-color",
          content: "#1a1a2e",
        },
      ],
    };

    if (this.env.UMAMI_URL && this.env.UMAMI_UUID) {
      head.script ??= [];
      head.script.push({
        defer: true,
        src: this.env.UMAMI_URL,
        "data-website-id": this.env.UMAMI_UUID,
      });
    }

    return head;
  });

  layout = $page({
    component: Layout,
    children: () => [
      this.home,
      this.changelog,
      this.m,
      this.github404,
      this.notFound,
    ],
  });

  home = $page({
    path: "/",
    component: Home,
    label: "Home",
    static: true,
    head: () => ({
      title: "TypeScript Framework Made Easy",
    }),
  });

  changelog = $page({
    path: "/changelog",
    component: () => <Changelog entries={changelog} />,
    label: "Changelog",
    static: true,
    head: () => ({
      title: "Changelog",
      description: "All notable changes to Alepha are documented here.",
    }),
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
    loader: async ({ params }) => {
      for (const pkg of docs) {
        if (pkg.slug === params.slug) {
          return { ...pkg, content: await pkg.content() };
        }
      }
      throw new NotFoundError("Document not found");
    },
    head: (args) => {
      const title = args.slug.startsWith("packages")
        ? args.slug
            .replace("packages-alepha-", "")
            .replaceAll("-", "/")
            .replace("/core", "")
        : args.name;

      const keywords = args.keywords ? args.keywords.join(",") : undefined;

      return {
        title,
        meta: keywords
          ? [
              {
                name: "keywords",
                content: keywords,
              },
            ]
          : undefined,
      };
    },
    errorHandler: (error) => {
      if (HttpError.is(error, 404)) {
        return <NotFound />;
      }
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
