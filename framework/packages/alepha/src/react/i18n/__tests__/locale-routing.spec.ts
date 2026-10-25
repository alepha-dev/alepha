import { Alepha } from "alepha";
import {
  $page,
  AlephaReactRouter,
  ReactPageProvider,
  RouterLocaleProvider,
} from "alepha/react/router";
import { ServerRouterProvider } from "alepha/server";
import { describe, test } from "vitest";

import { AlephaReactI18n } from "../index.ts";
import { $dictionary } from "../primitives/$dictionary.ts";
import { I18nProvider } from "../providers/I18nProvider.ts";

/**
 * End-to-end wiring of locale-prefix routing (`routing: "prefix"`) across the
 * i18n and router modules: configuration, outbound URL prefixing, and the
 * URL-as-source-of-truth language resolution.
 */
describe("locale-prefix routing", () => {
  class App {
    en = $dictionary({
      lazy: async () => ({ default: { hi: "Hi" } }),
    });
    fr = $dictionary({
      lazy: async () => ({ default: { hi: "Salut" } }),
    });
    about = $page({
      name: "about",
      path: "/about",
      component: () => "about",
    });
  }

  // Everything is injected BEFORE start() — the DI container locks once started.
  const start = async (routing: "none" | "prefix") => {
    const alepha = Alepha.create()
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);
    const locale = alepha.inject(RouterLocaleProvider);
    const pages = alepha.inject(ReactPageProvider);
    const server = alepha.inject(ServerRouterProvider);
    i18n.options.routing = routing;
    await alepha.start();
    return { alepha, i18n: i18n as any, locale, pages, server };
  };

  test("i18n configures the router locale provider from its dictionaries", async ({
    expect,
  }) => {
    const { locale } = await start("prefix");
    expect(locale.enabled).toBe(true);
    expect(locale.defaultLocale).toBe("en");
    expect(locale.locales).toEqual(["en", "fr"]);
    expect(locale.prefixedLocales).toEqual(["fr"]);
  });

  test("generated URLs carry the active locale prefix (default stays bare)", async ({
    expect,
  }) => {
    const { pages, locale } = await start("prefix");

    // default locale → unprefixed
    expect(pages.pathname("about")).toBe("/about");

    // active locale fr → prefixed
    locale.current = "fr";
    expect(pages.pathname("about")).toBe("/fr/about");
  });

  test("the URL locale wins over cookie and Accept-Language", async ({
    expect,
  }) => {
    const { i18n } = await start("prefix");

    // url prefix beats a conflicting cookie + header
    expect(i18n.resolveRequestLang("en", "en", "fr")).toBe("fr");
    // an unprefixed path resolves to the default locale (no redirect)
    expect(i18n.detectUrlLocale("/about")).toBe("en");
    expect(i18n.detectUrlLocale("/fr/about")).toBe("fr");
  });

  test("registers prefixed server route variants for non-default locales", async ({
    expect,
  }) => {
    const { server } = await start("prefix");
    const paths = server.getRoutes().map((route) => route.path);

    expect(paths).toContain("/about");
    expect(paths).toContain("/fr/about");
    // the default locale is never prefixed
    expect(paths).not.toContain("/en/about");
  });

  test("stays inert when routing is left as 'none'", async ({ expect }) => {
    const { i18n, pages, locale, server } = await start("none");

    expect(locale.enabled).toBe(false);
    expect(pages.pathname("about")).toBe("/about");
    expect(i18n.detectUrlLocale("/fr/about")).toBeUndefined();

    const paths = server.getRoutes().map((route) => route.path);
    expect(paths).toContain("/about");
    expect(paths).not.toContain("/fr/about");
  });
});
