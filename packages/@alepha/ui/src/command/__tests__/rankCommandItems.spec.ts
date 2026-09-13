import { describe, expect, it } from "vitest";

import { spotlightSearchText } from "../../shell/spotlightSearchText.ts";
import type { NavEntry } from "../../shell/useNavEntries.ts";
import { commandScore } from "../commandScore.ts";
import {
  defaultCommandFilter,
  defaultCommandItemToString,
  rankCommandItems,
} from "../rankCommandItems.ts";

const byText = (item: unknown) => defaultCommandItemToString(item);

describe("commandScore", () => {
  it("scores an exact match 1 and a miss 0", () => {
    expect(commandScore("Audit log", "Audit log")).toBe(1);
    expect(commandScore("Audit log", "zebra")).toBe(0);
  });

  it("matches a fuzzy subsequence, which a substring filter would not", () => {
    // "adl" is in no word of "Audit log", but it is a subsequence of it.
    expect(commandScore("Audit log", "adl")).toBeGreaterThan(0);
    expect("audit log".includes("adl")).toBe(false);
  });

  it("prefers a short string to a long one with the same match", () => {
    expect(commandScore("html", "html")).toBeGreaterThan(
      commandScore("html5", "html"),
    );
  });

  it("prefers a match at a word start to one inside a word", () => {
    expect(commandScore("Pages Admin Users", "us")).toBeGreaterThan(
      commandScore("Pages Admin Focus", "us"),
    );
  });

  it("appends aliases to the string, as cmdk's keywords", () => {
    expect(commandScore("Users", "people")).toBe(0);
    expect(commandScore("Users", "people", ["accounts", "people"])).toBe(
      commandScore("Users accounts people", "people"),
    );
  });
});

describe("rankCommandItems", () => {
  it("keeps every item, in the given order, for an empty query", () => {
    const items = ["Zeta", "Alpha", "Mid"];
    expect(rankCommandItems(items, "", defaultCommandFilter, byText)).toBe(
      items,
    );
  });

  it("drops what scores 0 and lists the rest best first, ties in given order", () => {
    const items = ["Settings", "Set", "Reset", "Tree"];
    expect(
      rankCommandItems(items, "set", defaultCommandFilter, byText),
    ).toEqual(["Set", "Settings", "Reset"]);
  });

  it("orders groups by their best item and drops empty ones", () => {
    const groups = [
      { key: "a", items: ["Tree", "Table"] },
      { key: "b", items: ["Nothing"] },
      { key: "c", items: ["Tab", "Tabs"] },
    ];
    expect(
      rankCommandItems(groups, "tab", defaultCommandFilter, byText),
    ).toEqual([
      { key: "c", items: ["Tab", "Tabs"] },
      { key: "a", items: ["Table"] },
    ]);
  });

  it("takes a custom filter's score, with the root's itemToString", () => {
    const items = [{ label: "One" }, { label: "Two" }];
    const filter = (item: { label: string }, _query: string) =>
      item.label === "Two" ? 2 : 1;
    expect(rankCommandItems(items, "x", filter, (item) => item.label)).toEqual([
      { label: "Two" },
      { label: "One" },
    ]);
  });

  /**
   * apps/ui's `NavPalette`, with its rows as they are today (`nav.ts`,
   * 2026-09-14): each row is searched by `group parent label`, and
   * deliberately NOT by its description, which `NavPalette.tsx` measured
   * wrecking the ranking under cmdk. `apps/ui/e2e/blocks.spec.ts` types
   * "audit" and expects Enter to land on the audit log, so the first row the
   * query leaves must be that one.
   */
  it("puts NavPalette's audit log first for 'audit'", () => {
    const row = (group: string, parent: string, label: string) => ({
      group,
      parent,
      label,
    });
    const groups = [
      { label: "", items: [row("", "", "Home")] },
      {
        label: "Blocks",
        items: [
          row("Blocks", "Layout", "App shell"),
          row("Blocks", "Layout", "Sidebar"),
          row("Blocks", "Layout", "Detail"),
          row("Blocks", "Layout", "Plate"),
          row("Blocks", "Layout", "Settings"),
          row("Blocks", "Layout", "Permission matrix"),
          row("Blocks", "Control", "Text"),
          row("Blocks", "Control", "Number"),
          row("Blocks", "Control", "Date"),
          row("Blocks", "Control", "Select"),
          row("Blocks", "AutoForm", "Basic"),
          row("Blocks", "AutoForm", "Object"),
          row("Blocks", "AutoForm", "Array"),
          row("Blocks", "", "Table"),
          row("Blocks", "", "Tree"),
          row("Blocks", "Messages", "Dialog"),
          row("Blocks", "Messages", "Toast"),
          row("Blocks", "", "Buttons"),
        ],
      },
      {
        label: "Pages",
        items: [
          row("Pages", "Auth", "Sign in"),
          row("Pages", "Auth", "Register"),
          row("Pages", "Auth", "Reset password"),
          row("Pages", "Auth", "Verify email"),
          row("Pages", "Auth", "Second factor"),
          row("Pages", "Account", "Profile"),
          row("Pages", "Account", "Security"),
          row("Pages", "Account", "Sessions"),
          row("Pages", "Account", "API keys"),
          row("Pages", "Account", "Connections"),
          row("Pages", "Admin", "Dashboard"),
          row("Pages", "Admin", "Users"),
          row("Pages", "Admin", "Sessions"),
          row("Pages", "Admin", "API keys"),
          row("Pages", "Admin", "Jobs"),
          row("Pages", "Admin", "Files"),
          row("Pages", "Admin", "Notifications"),
          row("Pages", "Admin", "Parameters"),
          row("Pages", "Admin", "Analytics"),
          row("Pages", "Admin", "Payments"),
          row("Pages", "Admin", "Audit log"),
        ],
      },
    ];
    const search = (item: { group: string; parent: string; label: string }) =>
      `${item.group} ${item.parent} ${item.label}`;

    const ranked = rankCommandItems(
      groups,
      "audit",
      defaultCommandFilter,
      search,
    ) as typeof groups;

    expect(ranked[0]?.items[0]?.label).toBe("Audit log");
    // And "layout" still finds every Layout leaf through the parent, which
    // is why the parent is in the string at all.
    const layout = rankCommandItems(
      groups,
      "layout",
      defaultCommandFilter,
      search,
    ) as typeof groups;
    expect(layout[0]?.items.map((item) => item.label).slice(0, 6)).toEqual([
      "App shell",
      "Sidebar",
      "Detail",
      "Plate",
      "Settings",
      "Permission matrix",
    ]);
  });

  /**
   * `Spotlight` finds a page by its `nav.keywords` and its description, not
   * only by its label: a page labelled "Users" is what "people" should open.
   */
  it("finds a Spotlight page by a keyword its label does not carry", () => {
    const entry = (
      name: string,
      label: string,
      extra: Partial<NavEntry> = {},
    ): NavEntry => ({
      name,
      href: `/${name}`,
      label,
      order: 0,
      groupOrder: 0,
      disabled: false,
      active: false,
      ...extra,
    });
    const entries = [
      entry("adminJobs", "Jobs"),
      entry("adminUsers", "Users", { keywords: ["accounts", "people"] }),
      entry("adminFiles", "Files", { description: "Uploaded documents" }),
    ];

    const people = rankCommandItems(
      entries,
      "people",
      defaultCommandFilter,
      spotlightSearchText,
    ) as NavEntry[];
    expect(people.map((it) => it.name)).toEqual(["adminUsers"]);

    const documents = rankCommandItems(
      entries,
      "documents",
      defaultCommandFilter,
      spotlightSearchText,
    ) as NavEntry[];
    expect(documents.map((it) => it.name)).toEqual(["adminFiles"]);
  });
});
