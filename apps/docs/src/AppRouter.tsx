import { $env, z } from "alepha";
import { $head, type Head, type HeadLink } from "alepha/react/head";
import { $page, NotFound } from "alepha/react/router";
import { $sitemap } from "alepha/react/sitemap";
import { HttpError, NotFoundError } from "alepha/server";

import Changelog from "./components/Changelog.tsx";
import Docs from "./components/Docs.tsx";
import Home from "./components/Home.tsx";
import { DOCS_THEME_BOOT_SCRIPT } from "./components/layout/docsTheme.ts";
import Layout from "./components/layout/Layout.tsx";
import type { DocProduct } from "./config/docs.ts";
import { changelog, docs, docsHref, docsOf } from "./config/docs.ts";

/**
 * `<link rel="alternate">` to the site's `llms.txt`, the index an agent
 * should read instead of the HTML around it.
 */
const llmsLink: HeadLink = {
  rel: "alternate",
  type: "text/plain",
  href: "/llms.txt",
};

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

  // `llms.txt` is written by `gen:llms` after the build, so no page knows
  // about it; listing it here is how a crawler does.
  sitemap = $sitemap({
    hostname: this.env.PUBLIC_URL,
    urls: ["/llms.txt"],
  });

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
      script: [DOCS_THEME_BOOT_SCRIPT],
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
        // For agents that land on any page: the index they should read
        // instead of the HTML.
        llmsLink,
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
   * The framework docs. Their URLs are frozen: 378 pages live under
   * `/docs/:slug` and every link to them, internal and external, would break
   * if this moved (quest #1603).
   *
   * Bay and Lore had their own doc sets here until they left this repository
   * (#E72). Their old URLs, `/bay/docs/*`, `/lore/docs/*` and the older flat
   * `/docs/bay-*` and `/docs/lore-*`, are redirected to their repositories by
   * `public/_redirects`, at the edge, before any route sees them.
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
    loader: async ({ params }) => this.loadDoc("", params.slug),
    head: (args) => this.docHead(args),
    errorHandler: (error) => {
      if (HttpError.is(error, 404)) {
        return <NotFound />;
      }
    },
  });

  /**
   * Narrowed by product as well as by slug: a slug is unique only within a doc
   * set, and the framework is the only doc set today, but a second one would
   * bring a second `guides-introduction` with it.
   */
  protected async loadDoc(product: DocProduct, slug: string) {
    for (const doc of docs) {
      if (doc.product === product && doc.slug === slug) {
        return { ...doc, content: await doc.content() };
      }
    }
    throw new NotFoundError("Document not found");
  }

  /**
   * ⚠️ The `.md` alternate is the page an agent should read. It is the same
   * source `gen-llms.ts` copies to `dist/public`, served as `text/markdown`,
   * so an agent that reached the HTML from a search finds its way to the
   * markdown without knowing the site's URL scheme.
   */
  protected docHead(args: {
    product: DocProduct;
    slug: string;
    name: string;
    keywords?: string[];
  }): Head {
    const title = args.slug.startsWith("packages")
      ? args.slug
          .replace("packages-alepha-", "")
          .replaceAll("-", "/")
          .replace("/core", "")
      : args.name;

    const keywords = args.keywords ? args.keywords.join(",") : undefined;

    const link: HeadLink[] = [
      { rel: "alternate", type: "text/markdown", href: `${docsHref(args)}.md` },
    ];

    return {
      title,
      link,
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
