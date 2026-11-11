import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { AlephaReactI18n } from "../index.ts";
import { $dictionary } from "../primitives/$dictionary.ts";
import { I18nProvider } from "../providers/I18nProvider.ts";

/**
 * Named arguments (`{name}` filled from `args: { name }`) and select (a
 * variant object chosen by `select: value`), next to positional `$1` (#Q3331).
 */
class App {
  en = $dictionary({
    lazy: async () => ({
      default: {
        greeting: "Hello {name}, your card ends in {last4}",
        "mixed.args": "{name} owes $1",
        "ticket.status": { open: "Open", closed: "Closed", other: "Unknown" },
        "ticket.count": {
          one: "{count} {kind} ticket",
          other: "{count} {kind} tickets",
        },
        braces: "Write {{name}} for a placeholder",
      },
    }),
  });
}

/**
 * A catalog written `as const`: its `{name}` placeholders are checked at
 * `tr()`.
 */
class Typed {
  en = $dictionary({
    lazy: async () => ({
      default: {
        greeting: "Hello {name}",
        "files.count": {
          one: "{count} file by {owner}",
          other: "{count} files",
        },
        plain: "No placeholder",
      } as const,
    }),
  });
}

const create = async () => {
  const alepha = Alepha.create().with(AlephaReactI18n);
  alepha.inject(App);
  const i18n = alepha.inject(I18nProvider);
  await alepha.start();
  return i18n;
};

describe("named arguments and select", () => {
  it("fills {name} from a record of string or number values", async () => {
    const i18n = await create();

    expect(i18n.tr("greeting", { args: { name: "Ada", last4: 4242 } })).toBe(
      "Hello Ada, your card ends in 4242",
    );
  });

  it("takes the record form in translate()", async () => {
    const i18n = await create();

    expect(i18n.translate("greeting", { name: "Ada", last4: "0001" })).toBe(
      "Hello Ada, your card ends in 0001",
    );
  });

  it("leaves a name with no argument as written", async () => {
    const i18n = await create();

    expect(i18n.tr("greeting", { args: { name: "Ada" } })).toBe(
      "Hello Ada, your card ends in {last4}",
    );
  });

  it("keeps positional arguments working, and never fills a name from an array", async () => {
    const i18n = await create();

    expect(i18n.tr("mixed.args", { args: ["5 €"] })).toBe("{name} owes 5 €");
    expect(i18n.tr("mixed.args", { args: [1, 2] })).toBe("{name} owes 1");
  });

  it("fills {count} from the count option only", async () => {
    const i18n = await create();

    expect(i18n.tr("ticket.count", { count: 2, args: { kind: "open" } })).toBe(
      "2 open tickets",
    );
    // A named argument called `count` is not the count.
    expect(i18n.tr("ticket.count", { args: { count: 9, kind: "open" } })).toBe(
      "{count} open tickets",
    );
  });

  it("selects a variant by name, and other when none matches", async () => {
    const i18n = await create();

    expect(i18n.tr("ticket.status", { select: "open" })).toBe("Open");
    expect(i18n.tr("ticket.status", { select: "closed" })).toBe("Closed");
    expect(i18n.tr("ticket.status", { select: "archived" })).toBe("Unknown");
    expect(i18n.tr("ticket.status")).toBe("Unknown");
    expect(i18n.translate("ticket.status", [], { select: "open" })).toBe(
      "Open",
    );
  });

  it("never selects through the prototype", async () => {
    const i18n = await create();

    expect(i18n.tr("ticket.status", { select: "constructor" })).toBe("Unknown");
    expect(i18n.tr("ticket.status", { select: "toString" })).toBe("Unknown");
  });

  it("selects a variant of a default", async () => {
    const i18n = await create();

    expect(
      i18n.tr("nope.missing", {
        select: "draft",
        default: { draft: "Draft", other: "Published" },
      }),
    ).toBe("Draft");
  });

  it("ignores select on a plain string entry", async () => {
    const i18n = await create();

    expect(
      i18n.tr("greeting", { select: "open", args: { name: "A", last4: 1 } }),
    ).toBe("Hello A, your card ends in 1");
  });

  it("writes a literal brace as {{ and }}", async () => {
    const i18n = await create();

    expect(i18n.tr("braces", { args: { name: "Ada" } })).toBe(
      "Write {name} for a placeholder",
    );
  });

  describe("types", () => {
    it("checks the names of an as const catalog, and accepts any record otherwise", async () => {
      const alepha = Alepha.create().with(AlephaReactI18n);
      alepha.inject(Typed);
      const typed = alepha.inject(I18nProvider<Typed, "en">);
      await alepha.start();

      expect(typed.tr("greeting", { args: { name: "Ada" } })).toBe("Hello Ada");
      expect(
        typed.tr("files.count", { count: 1, args: { owner: "Ada" } }),
      ).toBe("1 file by Ada");
      // Positional arguments are never checked against names.
      expect(typed.tr("greeting", { args: ["x"] })).toBe("Hello {name}");

      const untyped = await create();
      // A plain catalog: every value is `string`, so any record goes.
      expect(untyped.tr("greeting", { args: { anything: 1 } })).toBe(
        "Hello {name}, your card ends in {last4}",
      );

      const refused = () => {
        // @ts-expect-error `name` is missing
        typed.tr("greeting", { args: {} });
        // @ts-expect-error `nmae` is misspelled
        typed.tr("greeting", { args: { nmae: "Ada" } });
        // @ts-expect-error `owner` is used by the `one` variant
        typed.tr("files.count", { count: 1, args: {} });
        // @ts-expect-error count and select together
        untyped.tr("ticket.status", { count: 1, select: "open" });
      };
      void refused;
    });
  });
});
