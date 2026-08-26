import type { PageRoute } from "alepha/react/router";
import { describe, expect, it } from "vitest";

import {
  isActivePath,
  keepDeepestActive,
  type NavMeta,
  navGroupLabel,
  navLabel,
} from "../nav-tree-util.ts";

/**
 * Entries as `useNavEntries` builds them: `href` is the page's resolved
 * `match`, `active` is whatever `isActivePath` said about it in isolation.
 */
const entriesFor = (current: string, hrefs: string[]) =>
  hrefs.map((href) => ({ href, active: isActivePath(current, href) }));

const activeHrefs = (current: string, hrefs: string[]) =>
  keepDeepestActive(entriesFor(current, hrefs))
    .filter((entry) => entry.active)
    .map((entry) => entry.href);

describe("isActivePath", () => {
  it("matches the page itself and anything below it", () => {
    expect(isActivePath("/admin/users", "/admin/users")).toBe(true);
    expect(isActivePath("/admin/users/42", "/admin/users")).toBe(true);
  });

  it("does not match a sibling that merely shares a prefix", () => {
    // Without the trailing separator, "/admin/users-import" would look like a
    // descendant of "/admin/users".
    expect(isActivePath("/admin/users-import", "/admin/users")).toBe(false);
  });
});

describe("keepDeepestActive", () => {
  /*
    The account rail's regression. `AccountRouter.profile` sits at `path: "/"`
    under the `/account` shell, and `createMatch` collapses that to `/account`
    — the shell's own path — so the entry is a prefix of every sibling and lit
    up on all of them.
  */
  it("drops an index entry whose match is a prefix of its siblings", () => {
    const rail = [
      "/account", // Profile
      "/account/security",
      "/account/sessions",
      "/account/feedback",
    ];

    expect(activeHrefs("/account/security", rail)).toEqual([
      "/account/security",
    ]);
    expect(activeHrefs("/account/feedback", rail)).toEqual([
      "/account/feedback",
    ]);
  });

  it("keeps the index entry on the index route itself", () => {
    expect(activeHrefs("/account", ["/account", "/account/security"])).toEqual([
      "/account",
    ]);
  });

  it("keeps a section lit while one of its detail routes is open", () => {
    /*
      The behaviour the loose predicate exists for, and the reason this is
      deepest-wins rather than "an index entry must match exactly": nothing
      else in the rail matches `/admin/users/42`, so the section stays active.
    */
    const rail = ["/admin/users", "/admin/sessions", "/admin/keys"];

    expect(activeHrefs("/admin/users/42", rail)).toEqual(["/admin/users"]);
  });

  it("keeps an index entry lit on a child route it genuinely owns", () => {
    // Same shape as the first case, except no sibling claims the child — so
    // the index entry is still the deepest match and must survive.
    expect(
      activeHrefs("/account/photo", ["/account", "/account/security"]),
    ).toEqual(["/account"]);
  });

  it("marks nothing active when the current path is outside the shell", () => {
    expect(activeHrefs("/projects", ["/account", "/account/security"])).toEqual(
      [],
    );
  });

  it("leaves a list with a single active entry untouched", () => {
    expect(activeHrefs("/admin/keys", ["/admin/users", "/admin/keys"])).toEqual(
      ["/admin/keys"],
    );
  });
});

/**
 * Only the fields the labelling chain reads. `PageRoute` is far wider, and a
 * literal cast keeps the cases legible. `nav` is the shell's own
 * {@link NavMeta} — the framework types it as the narrower `PageNav`, which is
 * exactly the widening `navMeta` performs at runtime.
 */
const route = (
  page: Partial<Omit<PageRoute, "nav">> & { nav?: NavMeta },
): PageRoute => ({ name: "page", ...page }) as PageRoute;

/**
 * A catalogue holding French for two keys and nothing else, behaving like
 * `I18nProvider.tr`: a hit wins, a miss falls back to the caller's default.
 */
const tr = (key: string, options?: { default?: string }) => {
  const fr: Record<string, string> = {
    "admin.nav.users": "Utilisateurs",
    "admin.nav.group.identity": "Identité",
  };
  return fr[key] ?? options?.default ?? key;
};

describe("navLabel", () => {
  it("falls back through label, page label, head title, then the name", () => {
    expect(navLabel(route({ nav: { label: "Users" } }))).toBe("Users");
    expect(navLabel(route({ label: "Users" }))).toBe("Users");
    expect(navLabel(route({ head: { title: "Users" } }))).toBe("Users");
    expect(navLabel(route({ name: "users" }))).toBe("users");
  });

  it("resolves the catalogue key when one is declared", () => {
    const page = route({
      nav: { label: "Users", labelKey: "admin.nav.users" },
    });
    expect(navLabel(page, tr)).toBe("Utilisateurs");
  });

  /*
    The whole point of keeping `label` beside the key: an application that
    spreads no catalogue must keep seeing what it saw before, never a raw key.
  */
  it("renders the English label when the catalogue has no entry", () => {
    const page = route({ nav: { label: "Jobs", labelKey: "admin.nav.jobs" } });
    expect(navLabel(page, tr)).toBe("Jobs");
  });

  it("ignores the key when no translator is supplied", () => {
    // Server-side and in the specs, `navLabel` is called without one.
    const page = route({
      nav: { label: "Users", labelKey: "admin.nav.users" },
    });
    expect(navLabel(page)).toBe("Users");
  });

  it("uses the route name as the default when the label is an element", () => {
    // `tr` needs a string default; a node cannot be one, and the raw key must
    // never reach the sidebar.
    const page = route({
      name: "widgets",
      nav: { label: { type: "span" } as any, labelKey: "unknown.key" },
    });
    expect(navLabel(page, tr)).toBe("widgets");
  });
});

describe("navGroupLabel", () => {
  it("has nothing to say about an ungrouped page", () => {
    expect(navGroupLabel(route({ nav: { label: "Dashboard" } }), tr)).toBe(
      undefined,
    );
  });

  it("translates the heading while `group` stays the grouping key", () => {
    const page = route({
      nav: {
        label: "Users",
        group: "Identity",
        groupKey: "admin.nav.group.identity",
      },
    });
    expect(navGroupLabel(page, tr)).toBe("Identité");
    // The bucket key itself must not move, or two pages in one section would
    // stop agreeing on it as soon as the language changed.
    expect(page.nav?.group).toBe("Identity");
  });

  it("falls back to the group name", () => {
    expect(navGroupLabel(route({ nav: { group: "Commerce" } }), tr)).toBe(
      "Commerce",
    );
    expect(
      navGroupLabel(
        route({ nav: { group: "System", groupKey: "unknown.key" } }),
        tr,
      ),
    ).toBe("System");
  });
});
