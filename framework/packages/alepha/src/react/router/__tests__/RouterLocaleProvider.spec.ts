import { Alepha } from "alepha";
import { describe, test } from "vitest";

import { RouterLocaleProvider } from "../providers/RouterLocaleProvider.ts";

describe("RouterLocaleProvider", () => {
  const setup = (config?: Parameters<RouterLocaleProvider["configure"]>[0]) => {
    const alepha = Alepha.create();
    const provider = alepha.inject(RouterLocaleProvider);
    if (config) {
      provider.configure(config);
    }
    return provider;
  };

  describe("when disabled (default)", () => {
    test("detect leaves the pathname untouched", ({ expect }) => {
      const provider = setup();
      expect(provider.detect("/fr/about")).toEqual({
        locale: "",
        pathname: "/fr/about",
      });
    });

    test("withPrefix returns the pathname unchanged", ({ expect }) => {
      const provider = setup();
      expect(provider.withPrefix("/about", "fr")).toBe("/about");
    });
  });

  describe("when enabled with default 'en' and locales [en, fr, de]", () => {
    const config = {
      enabled: true,
      defaultLocale: "en",
      locales: ["en", "fr", "de"],
    };

    test("exposes only non-default locales as prefixed", ({ expect }) => {
      const provider = setup(config);
      expect(provider.prefixedLocales).toEqual(["fr", "de"]);
    });

    test("detect strips a known prefixed locale", ({ expect }) => {
      const provider = setup(config);
      expect(provider.detect("/fr/about")).toEqual({
        locale: "fr",
        pathname: "/about",
      });
    });

    test("detect treats an unprefixed path as the default locale", ({
      expect,
    }) => {
      const provider = setup(config);
      expect(provider.detect("/about")).toEqual({
        locale: "en",
        pathname: "/about",
      });
    });

    test("detect ignores a segment that is the default locale", ({
      expect,
    }) => {
      const provider = setup(config);
      // /en is NOT a prefixed locale (default is unprefixed), so it is a normal path
      expect(provider.detect("/en/about")).toEqual({
        locale: "en",
        pathname: "/en/about",
      });
    });

    test("detect normalizes the bare locale root to '/'", ({ expect }) => {
      const provider = setup(config);
      expect(provider.detect("/fr")).toEqual({ locale: "fr", pathname: "/" });
      expect(provider.detect("/fr/")).toEqual({ locale: "fr", pathname: "/" });
    });

    test("detect strips a deep prefixed path", ({ expect }) => {
      const provider = setup(config);
      expect(provider.detect("/de/c/42/quest")).toEqual({
        locale: "de",
        pathname: "/c/42/quest",
      });
    });

    test("withPrefix prepends a non-default locale", ({ expect }) => {
      const provider = setup(config);
      expect(provider.withPrefix("/about", "fr")).toBe("/fr/about");
    });

    test("withPrefix leaves the default locale unprefixed", ({ expect }) => {
      const provider = setup(config);
      expect(provider.withPrefix("/about", "en")).toBe("/about");
    });

    test("withPrefix handles the root path", ({ expect }) => {
      const provider = setup(config);
      expect(provider.withPrefix("/", "fr")).toBe("/fr");
    });

    test("withPrefix ignores an unknown locale", ({ expect }) => {
      const provider = setup(config);
      expect(provider.withPrefix("/about", "zz")).toBe("/about");
    });
  });

  describe("current locale (store-backed)", () => {
    test("defaults to the default locale", ({ expect }) => {
      const provider = setup({
        enabled: true,
        defaultLocale: "en",
        locales: ["en", "fr"],
      });
      expect(provider.current).toBe("en");
    });

    test("withPrefix uses current() when no locale is passed", ({ expect }) => {
      const provider = setup({
        enabled: true,
        defaultLocale: "en",
        locales: ["en", "fr"],
      });
      provider.current = "fr";
      expect(provider.current).toBe("fr");
      expect(provider.withPrefix("/about")).toBe("/fr/about");
    });
  });

  /**
   * Excluded subtrees: the signed-in surfaces (`/admin`, `/account`) that keep
   * one canonical URL while the public site is locale-prefixed.
   */
  describe("excluded paths", () => {
    const excludedConfig = {
      enabled: true,
      defaultLocale: "fr",
      locales: ["fr", "en"],
      excluded: ["/admin", "/account"],
    };

    test("matches the prefix itself and anything under it", ({ expect }) => {
      const provider = setup(excludedConfig);
      expect(provider.isExcluded("/admin")).toBe(true);
      expect(provider.isExcluded("/admin/pieces")).toBe(true);
      expect(provider.isExcluded("/account/security")).toBe(true);
    });

    /**
     * The exclusion is a path prefix, not a string prefix. `/administration`
     * is a different page and a storefront is entitled to one.
     */
    test("does not match a longer first segment", ({ expect }) => {
      const provider = setup(excludedConfig);
      expect(provider.isExcluded("/administration")).toBe(false);
      expect(provider.isExcluded("/accounts")).toBe(false);
    });

    test("withPrefix leaves an excluded path unprefixed", ({ expect }) => {
      const provider = setup(excludedConfig);
      expect(provider.withPrefix("/admin/pieces", "en")).toBe("/admin/pieces");
      // …while the public site still prefixes normally.
      expect(provider.withPrefix("/atelier", "en")).toBe("/en/atelier");
    });

    /**
     * The regression that made the language switch look half-working: `detect`
     * reports the DEFAULT locale for any unprefixed path, so adopting it on
     * `/admin` published "the URL says French" and overwrote the cookie that is
     * the only carrier of the choice there.
     */
    test("adopt does not touch the current locale on an excluded path", ({
      expect,
    }) => {
      const provider = setup(excludedConfig);
      provider.current = "en";

      expect(provider.adopt("/admin/pieces")).toBe("/admin/pieces");
      expect(provider.current).toBe("en");
    });

    test("adopt still takes the locale from a public path", ({ expect }) => {
      const provider = setup(excludedConfig);
      provider.current = "en";

      expect(provider.adopt("/atelier")).toBe("/atelier");
      expect(provider.current).toBe("fr");
    });

    test("adopt strips the prefix and adopts it on a public path", ({
      expect,
    }) => {
      const provider = setup(excludedConfig);
      expect(provider.adopt("/en/atelier")).toBe("/atelier");
      expect(provider.current).toBe("en");
    });

    /**
     * An `/en/admin` bookmark from before the exclusion still resolves: the
     * locale is stripped so the route matches, it is simply not adopted.
     */
    test("a stale prefixed URL still resolves to the canonical path", ({
      expect,
    }) => {
      const provider = setup(excludedConfig);
      provider.current = "fr";
      expect(provider.adopt("/en/admin")).toBe("/admin");
      expect(provider.current).toBe("fr");
    });

    test("no exclusions configured leaves every path prefixable", ({
      expect,
    }) => {
      const provider = setup({
        enabled: true,
        defaultLocale: "fr",
        locales: ["fr", "en"],
      });
      expect(provider.isExcluded("/admin")).toBe(false);
      expect(provider.withPrefix("/admin", "en")).toBe("/en/admin");
    });
  });
});
