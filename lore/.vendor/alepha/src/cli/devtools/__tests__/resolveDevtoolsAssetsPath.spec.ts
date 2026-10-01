import { describe, expect, it } from "vitest";

import { resolveDevtoolsAssetsPath } from "../index.ts";

/**
 * Projects scaffolded by `alepha init` before #Q2280 carry `devtools()` in
 * their generated config, so the uninstall path is not hypothetical: drop
 * `@alepha/devtools` from package.json and the plugin must not take the
 * whole config load down with it.
 */
describe("resolveDevtoolsAssetsPath", () => {
  it("resolves the asset directory when the package is installed", () => {
    const path = resolveDevtoolsAssetsPath();

    expect(path).toBeDefined();
    expect(path).toMatch(/assets[\\/]ui$/);
  });

  it("returns undefined instead of throwing when the package is gone", () => {
    const missing = () => {
      throw Object.assign(new Error("Cannot find module"), {
        code: "MODULE_NOT_FOUND",
      });
    };

    expect(() => resolveDevtoolsAssetsPath(missing)).not.toThrow();
    expect(resolveDevtoolsAssetsPath(missing)).toBeUndefined();
  });
});
