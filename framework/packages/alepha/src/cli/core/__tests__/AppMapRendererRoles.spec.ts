import { Alepha } from "alepha";
import { describe, it } from "vitest";

import {
  type AppMapInput,
  AppMapRenderer,
} from "../services/AppMapRenderer.ts";

/**
 * The `roles` section in full is the one list whose items span several lines:
 * a role, then its grants and its effective permissions indented under it.
 */
describe("AppMapRenderer, a filtered roles section", () => {
  const input = (): AppMapInput => ({
    name: "SHOP",
    actions: [],
    entities: [],
    pages: [],
    jobs: [],
    topics: [],
    envs: [],
    roles: [
      {
        name: "admin",
        grants: [{ name: "orders:*" }],
        effective: ["orders:read"],
        viaWildcard: ["orders:read"],
      },
      {
        name: "guest",
        grants: [{ name: "catalog:read" }],
        effective: ["catalog:read"],
        viaWildcard: [],
      },
    ],
  });

  const renderer = () => Alepha.create().inject(AppMapRenderer);

  it("keeps the grants and effective permissions of a role it keeps", ({
    expect,
  }) => {
    const text = renderer().render(input(), "roles", "admin");

    expect(text).toContain('## Roles (1 matching "admin")');
    expect(text).toContain("- `admin` (1 permissions)");
    expect(text).toContain("  - grants: orders:*");
    expect(text).toContain("  - effective: orders:read");
    expect(text).not.toContain("guest");
    expect(text).not.toContain("catalog:read");
  });

  it("finds a role by a permission it grants", ({ expect }) => {
    const text = renderer().render(input(), "roles", "orders");

    expect(text).toContain('## Roles (1 matching "orders")');
    expect(text).toContain("- `admin` (1 permissions)");
    expect(text).not.toContain("guest");
  });

  it("still filters a one-line list item by item", ({ expect }) => {
    const text = renderer().render(input(), undefined, "guest");

    expect(text).toContain('## Roles (1 matching "guest")');
    expect(text).toContain("- `guest` (1 permissions)");
    expect(text).not.toContain("admin");
  });
});
