import { describe, expect, it } from "vitest";

import { ReactRouter } from "../services/ReactRouter.ts";

/**
 * `isActive(href, { startWith: true })` used a bare `current.startsWith(href)`,
 * so `/foo` reported active on `/foobar` — no segment boundary. This drives
 * nav highlighting in every sidebar, where a short parent href like
 * `/settings` lights up on an unrelated `/settings-archive`.
 */
const routerAt = (pathname: string): ReactRouter<any> =>
  Object.create(ReactRouter.prototype, {
    state: { value: { url: new URL(`http://localhost${pathname}`) } },
  }) as ReactRouter<any>;

describe("isActive with startWith", () => {
  it("matches the exact path", () => {
    expect(routerAt("/foo").isActive("/foo", { startWith: true })).toBe(true);
  });

  it("matches a descendant path", () => {
    expect(routerAt("/foo/bar").isActive("/foo", { startWith: true })).toBe(
      true,
    );
    expect(routerAt("/foo/bar/baz").isActive("/foo", { startWith: true })).toBe(
      true,
    );
  });

  it("does NOT match a sibling that merely shares a prefix", () => {
    expect(routerAt("/foobar").isActive("/foo", { startWith: true })).toBe(
      false,
    );
    expect(
      routerAt("/settings-archive").isActive("/settings", { startWith: true }),
    ).toBe(false);
  });

  it("tolerates a trailing slash on either side", () => {
    expect(routerAt("/foo/").isActive("/foo", { startWith: true })).toBe(true);
    expect(routerAt("/foo").isActive("/foo/", { startWith: true })).toBe(true);
  });

  it("treats the root href as active everywhere under it", () => {
    expect(routerAt("/anything").isActive("/", { startWith: true })).toBe(true);
    expect(routerAt("/").isActive("/", { startWith: true })).toBe(true);
  });

  it("without startWith, only the exact path matches", () => {
    expect(routerAt("/foo/bar").isActive("/foo")).toBe(false);
    expect(routerAt("/foobar").isActive("/foo")).toBe(false);
    expect(routerAt("/foo").isActive("/foo")).toBe(true);
  });
});

/**
 * A path holding a percent-encoded character was never active (feedback
 * #P2199, #Q2338): a link built from a param carries `%24` where a tree of
 * hrefs carries `$`, and every `$primitive` page of the docs opened with the
 * Explorer collapsed and nothing marked.
 */
describe("isActive with an encoded character", () => {
  const encoded = "/docs/reference-primitives-%24sitemap";
  const decoded = "/docs/reference-primitives-$sitemap";

  it("treats the two spellings as one path, whichever side is encoded", () => {
    expect(routerAt(encoded).isActive(decoded)).toBe(true);
    expect(routerAt(decoded).isActive(encoded)).toBe(true);
    expect(routerAt(encoded).isActive(encoded)).toBe(true);
  });

  it("still tolerates a trailing slash", () => {
    expect(routerAt(`${encoded}/`).isActive(decoded)).toBe(true);
    expect(routerAt(encoded).isActive(`${decoded}/`)).toBe(true);
  });

  it("matches a descendant on the decoded form, on a segment boundary", () => {
    expect(
      routerAt("/docs/%24primitives/sitemap").isActive("/docs/$primitives", {
        startWith: true,
      }),
    ).toBe(true);
    expect(
      routerAt("/docs/%24primitives-archive").isActive("/docs/$primitives", {
        startWith: true,
      }),
    ).toBe(false);
  });

  it("decodes a space and a non-ASCII character too", () => {
    expect(routerAt("/a%20b/caf%C3%A9").isActive("/a b/café")).toBe(true);
  });

  it("does not throw on a malformed escape, and compares it verbatim", () => {
    expect(() => routerAt("/docs/%E0%A4%A").isActive("/docs/x")).not.toThrow();
    expect(routerAt("/docs/%E0%A4%A").isActive("/docs/%E0%A4%A")).toBe(true);
    expect(routerAt("/docs/%E0%A4%A").isActive("/docs/x")).toBe(false);
  });

  it("never turns an encoded slash into a segment boundary", () => {
    expect(routerAt("/foo%2Fbar").isActive("/foo", { startWith: true })).toBe(
      false,
    );
  });
});
