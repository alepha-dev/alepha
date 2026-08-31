import { $env, z } from "alepha";
import { $head, type Head } from "alepha/react/head";
import { $page, NotFound, Redirection } from "alepha/react/router";
import { $sitemap } from "alepha/react/sitemap";
import { HttpError, NotFoundError } from "alepha/server";

import Changelog from "./components/Changelog.tsx";
import Docs from "./components/Docs.tsx";
import Home from "./components/Home.tsx";
import Layout from "./components/layout/Layout.tsx";
import BayHome from "./components/product/BayHome.tsx";
import LoreHome from "./components/product/LoreHome.tsx";
import type { DocProduct } from "./config/docs.ts";
import { changelog, docs, docsHref, docsOf } from "./config/docs.ts";

declare module "alepha/react/router" {
  interface PagePrimitiveOptions {
    sidebar?: boolean;
  }
}

export class AppRouter {
  env = $env(
    z.object({
      // `secret: false` because this is the site's address - without it the
      // deploy pushes it to the worker as an encrypted secret, which is silly
      // for a value printed in every page's `<head>`.
      PUBLIC_URL: z.text({ secret: false }).default("https://alepha.dev"),
    }),
  );

  sitemap = $sitemap({ hostname: this.env.PUBLIC_URL });

  head = $head(() => {
    // This string is the one social unfurlers and search results show, so it
    // is the tagline that has to agree with the README, the npm description
    // and the repository description.
    const ogTitle =
      "Alepha | A full-stack TypeScript framework. One schema, everywhere.";
    const head: Head = {
      title: "Alepha",
      titleSeparator: " | ",
      description:
        "Alepha is a full-stack TypeScript framework: a clean rewrite of server, ORM, auth, queues, and React SSR for Node, Bun, and Cloudflare. One schema, everywhere.",
      image: `${this.env.PUBLIC_URL}/og-image.png`,
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
        // No `rel="icon"` here on purpose: ReactServerProvider detects
        // `public/favicon.png` and emits the tag itself, into early head.
        // Declaring it again put two of them in every page.
        {
          rel: "manifest",
          href: "/manifest.json",
        },
        {
          rel: "apple-touch-icon",
          href: "/apple-touch-icon.png",
        },
      ],
      // One `theme-color` per scheme, so the phone's address bar matches the
      // page it is framing instead of guessing. Both values are `--color-bg`
      // from `variables.css`; the dark one is also `background_color` /
      // `theme_color` in `public/manifest.json`, which has no light variant to
      // give it. Keep all three in step.
      //
      // These were a single `#1a1a2e` for a long time - a colour from a
      // palette this site no longer uses, which appears in no stylesheet.
      meta: [
        {
          name: "theme-color",
          content: "#ffffff",
          media: "(prefers-color-scheme: light)",
        },
        {
          name: "theme-color",
          content: "#010409",
          media: "(prefers-color-scheme: dark)",
        },
      ],
    };

    return head;
  });

  layout = $page({
    component: Layout,
    children: () => [
      this.home,
      this.lore,
      this.bay,
      this.changelog,
      this.m,
      this.bayDocs,
      this.loreDocs,
      this.github404,
      this.notFound,
    ],
  });

  lore = $page({
    path: "/lore",
    component: LoreHome,
    label: "Lore",
    static: true,
    head: () => ({
      title: "Lore. Project management, for agents too.",
      description:
        "An open-source project management app built on Alepha. Quests, folios, feedback and crash telemetry, readable and writable over MCP.",
    }),
  });

  bay = $page({
    path: "/bay",
    component: BayHome,
    label: "Bay",
    static: true,
    head: () => ({
      title: "Bay. Your own VPS, without the yak shaving.",
      description:
        "A self-hosted application server for Alepha apps, with TLS, rollback and process isolation handled for you.",
    }),
  });

  home = $page({
    path: "/",
    component: Home,
    label: "Home",
    static: true,
    head: () => ({
      title: "A full-stack TypeScript framework. One schema, everywhere.",
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

  /**
   * The framework docs, and the ONLY one of the three whose URLs are frozen.
   * 378 pages live under `/docs/:slug` and every link to them, internal and
   * external, would break if this moved (quest #1603).
   *
   * It also carries the redirects for the two doc sets that DID move: a slug
   * beginning `bay-` or `lore-` was a Bay or Lore page under this route until
   * this change, and those URLs are live. The check runs before the lookup
   * because there is no longer a framework page by either name to find.
   */
  m = $page({
    sidebar: true,
    path: "/docs/:slug",
    component: Docs,
    schema: {
      params: z.object({
        slug: z.text(),
      }),
    },
    static: {
      entries: docsOf("").map((it) => ({
        params: { slug: it.slug },
        label: it.name,
      })),
    },
    loader: async ({ params }) => {
      for (const product of ["bay", "lore"] as const) {
        if (params.slug.startsWith(`${product}-`)) {
          throw new Redirection(
            docsHref({
              product,
              slug: params.slug.slice(product.length + 1),
            }),
          );
        }
      }
      return this.loadDoc("", params.slug);
    },
    head: (args) => this.docHead(args),
    errorHandler: (error) => {
      if (HttpError.is(error, 404)) {
        return <NotFound />;
      }
    },
  });

  bayDocs = $page({
    sidebar: true,
    path: "/bay/docs/:slug",
    component: Docs,
    schema: { params: z.object({ slug: z.text() }) },
    static: {
      entries: docsOf("bay").map((it) => ({
        params: { slug: it.slug },
        label: it.name,
      })),
    },
    loader: async ({ params }) => this.loadDoc("bay", params.slug),
    head: (args) => this.docHead(args),
    errorHandler: (error) => {
      if (HttpError.is(error, 404)) {
        return <NotFound />;
      }
    },
  });

  loreDocs = $page({
    sidebar: true,
    path: "/lore/docs/:slug",
    component: Docs,
    schema: { params: z.object({ slug: z.text() }) },
    static: {
      entries: docsOf("lore").map((it) => ({
        params: { slug: it.slug },
        label: it.name,
      })),
    },
    loader: async ({ params }) => this.loadDoc("lore", params.slug),
    head: (args) => this.docHead(args),
    errorHandler: (error) => {
      if (HttpError.is(error, 404)) {
        return <NotFound />;
      }
    },
  });

  /**
   * ⚠️ Narrowed by product, not by slug alone. A slug is unique only within a
   * doc set now, so `guides-introduction` exists three times and a search of
   * the flat list would answer with whichever came first.
   */
  protected async loadDoc(product: DocProduct, slug: string) {
    for (const doc of docs) {
      if (doc.product === product && doc.slug === slug) {
        return { ...doc, content: await doc.content() };
      }
    }
    throw new NotFoundError("Document not found");
  }

  protected docHead(args: { slug: string; name: string; keywords?: string[] }) {
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
  }

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
