import { $hook, $inject, Alepha } from "alepha";
import { $head, type Head } from "alepha/react/head";
import { ReactRouter } from "alepha/react/router";
import { $manifest, $robots } from "alepha/react/sitemap";
import { currentUserAtom } from "alepha/security";
import { isHttpError } from "alepha/server";

import { ReportsTabRegistry } from "./registries/ReportsTabRegistry.ts";
import { ProjectTrail } from "./services/ProjectTrail.ts";
import { ReportsCsv } from "./services/ReportsCsv.ts";
import { ReportsDrillDown } from "./services/ReportsDrillDown.ts";
import { ReportsSummaryMarkdown } from "./services/ReportsSummaryMarkdown.ts";
import { ReportsUrlQuery } from "./services/ReportsUrlQuery.ts";

/**
 * What core's web side does at boot, kept out of `CoreRouter` (#Q3400).
 *
 * A class holding pages beside a `$hook`, a boot primitive or a registration
 * in its constructor is created at boot; one holding only pages can be
 * created on the first page request that needs it. So `CoreRouter` keeps its
 * pages, and its boot work lives here, registered by `LoreCoreWeb` beside it:
 *
 * - the 401 redirect to the sign-in page, a browser-only hook;
 * - the global head, `robots.txt` and the web app manifest, which every page
 *   reads whichever router it belongs to;
 * - the summary tab of the reports shell;
 * - the reports services that components reach through `useInject`, which
 *   cannot construct a service once the container is locked.
 */
export class CoreWebBoot {
  protected readonly alepha = $inject(Alepha);
  protected readonly router = $inject(ReactRouter);
  protected readonly reportsTabs = $inject(ReportsTabRegistry);
  protected readonly trail = $inject(ProjectTrail);

  // Read by components through `useInject`, so they exist before the lock.
  protected readonly reportsUrl = $inject(ReportsUrlQuery);
  protected readonly reportsCsv = $inject(ReportsCsv);
  protected readonly reportsDrillDown = $inject(ReportsDrillDown);
  protected readonly reportsMarkdown = $inject(ReportsSummaryMarkdown);

  constructor() {
    this.reportsTabs.register({
      route: "reportsSummary",
      labelKey: "project.reports.nav.summary",
      order: 5,
      filters: ["period"],
    });
  }

  /**
   * A request refused with a 401 in the browser sends the visitor to the
   * sign-in page, carrying where they were.
   */
  protected readonly onFetchError = $hook({
    on: "client:request:error",
    handler: async ({ error }) => {
      const loginPath = this.router.path("login");
      if (
        this.alepha.isBrowser() &&
        isHttpError(error, 401) &&
        this.router.state.url.pathname !== loginPath
      ) {
        this.alepha.store.set(currentUserAtom, undefined);
        await this.router.push(loginPath as `/${string}`, {
          query: {
            redirect: this.router.state.url.pathname,
          },
        });
      }
    },
  });

  /**
   * Every project page's title is its breadcrumb trail (#Q3408): "MCS ›
   * Estates › ovh", the labels `ProjectView` draws, joined. One rule for the
   * whole subtree, computed by `ProjectTrail` after every page head has
   * merged, so a page's own `head.title` under this route no longer decides
   * the tab. Pages outside a project, and an error layer, keep their own.
   *
   * Here and not on `ProjectRouter`: a `$head` is global, every render reads
   * it, so its class is created at boot (#Q3404).
   */
  protected readonly trailTitle = $head({
    afterPages: ({ layers }) => {
      if (
        !layers.some((layer) => layer.name === "project") ||
        layers.some((layer) => layer.error)
      ) {
        return undefined;
      }
      const page = layers[layers.length - 1];
      const title = this.trail.title(page?.name ?? "", page?.params ?? {});
      return title ? { title } : undefined;
    },
  });

  protected readonly head = $head(() => {
    const head: Head = {
      title: "Alepha Lore",
      description:
        "Alepha Lore - project and knowledge management for builders.",
    };

    head.link = [
      {
        rel: "icon",
        href: "/favicon.png",
        type: "image/png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        rel: "icon",
        href: "/favicon-light.png",
        type: "image/png",
        media: "(prefers-color-scheme: light)",
      },
    ];

    head.meta = [
      { name: "theme-color", content: "#010409" },
      {
        name: "keywords",
        content:
          "Alepha Lore, project management, task tracking, knowledge management, MCP, AI, quests, open-source",
      },
    ];

    return head;
  });

  /**
   * A self-hosted Lore has its own `PUBLIC_URL`, or none, and answers for its
   * own host. `/auth` is worth no crawler's time: every unknown URL leads to
   * the login page.
   */
  protected readonly robots = $robots({ disallow: ["/auth"] });

  protected readonly manifest = $manifest({
    name: "Lore",
    shortName: "Lore",
    description:
      "Alepha Lore: planning memory, telemetry and deployments for Alepha applications.",
    display: "standalone",
    startUrl: "/",
    backgroundColor: "#010409",
    themeColor: "#010409",
    orientation: "portrait",
    icons: [{ src: "/logo-512x512.png", sizes: "512x512", type: "image/png" }],
    screenshots: [
      {
        src: "/screenshot-1.png",
        type: "image/png",
        sizes: "1280x605",
        formFactor: "wide",
        label: "App Overview",
      },
      {
        src: "/screenshot-2.png",
        type: "image/png",
        sizes: "365x800",
        formFactor: "narrow",
        label: "Quest Detail",
      },
    ],
  });
}
