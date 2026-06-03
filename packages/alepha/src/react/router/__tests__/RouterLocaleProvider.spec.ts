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
});
