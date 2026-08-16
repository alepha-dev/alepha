import { describe, expect, it } from "vitest";
import { isActivePath, keepDeepestActive } from "../nav-tree-util.ts";

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
