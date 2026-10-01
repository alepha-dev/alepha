import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { AlephaReactI18n } from "../index.ts";
import { $dictionary } from "../primitives/$dictionary.ts";
import { I18nProvider } from "../providers/I18nProvider.ts";

/**
 * `tr(key, { default, args })` used to return the default RAW, so an
 * application with no catalogue entry for the key rendered the literal `$1`.
 * The default is precisely what such an application shows, which made the
 * combination of a default and arguments useless.
 */
describe("tr() defaults and arguments", () => {
  class App {
    en = $dictionary({
      lazy: async () => ({ default: { "some.key": "Translated $1" } }),
    });
  }

  const create = async () => {
    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);
    await alepha.start();
    return i18n;
  };

  it("should substitute into an untranslated default", async () => {
    const i18n = await create();

    expect(
      i18n.tr("nope.missing", { default: "Revoke $1", args: ["CI pipeline"] }),
    ).toBe("Revoke CI pipeline");
  });

  it("should still prefer the translation when there is one", async () => {
    const i18n = await create();

    expect(i18n.tr("some.key", { default: "Default $1", args: ["x"] })).toBe(
      "Translated x",
    );
  });

  it("should leave a placeholder with no argument alone", async () => {
    const i18n = await create();

    expect(i18n.tr("nope.missing", { default: "Revoke $1" })).toBe("Revoke $1");
  });

  it("should return the default unchanged when it has no placeholder", async () => {
    const i18n = await create();

    expect(i18n.tr("nope.missing", { default: "Revoke", args: ["x"] })).toBe(
      "Revoke",
    );
  });
});
