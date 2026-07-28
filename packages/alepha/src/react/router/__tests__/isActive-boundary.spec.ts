import { describe, expect, it } from "vitest";
import { ReactRouter } from "../services/ReactRouter.ts";

/**
 * `isActive(href, { startWith: true })` used a bare `current.startsWith(href)`,
 * so `/foo` reported active on `/foobar` — no segment boundary. This drives
 * nav highlighting in every sidebar, where a short parent href like
 * `/settings` lights up on an unrelated `/settings-archive`.
 */
const routerAt = (pathname: string): ReactRouter<any> =>
  ({
    state: { url: new URL(`http://localhost${pathname}`) },
    isActive: ReactRouter.prototype.isActive,
  }) as unknown as ReactRouter<any>;

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
