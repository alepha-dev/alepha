import { Alepha } from "alepha";
import { defineConfig } from "alepha/cli/config";
import { describe, expect, it } from "vitest";

import { metaOptions } from "../atoms/metaOptions.ts";

/**
 * The build-time half of build metadata.
 *
 * These values must be baked before the client bundle is compiled, so they
 * cannot come from a runtime atom the way the `/version` route's options do.
 */
describe("defineConfig({ meta })", () => {
  it("should carry an app's own version through to the build", () => {
    // The case this exists for: an app that deploys on every push, where the
    // git tag chain resolves to "latest" on everything that is not a release.
    const alepha = Alepha.create();

    defineConfig({ meta: { version: "0.27.1" } })(alepha);

    expect(alepha.get(metaOptions).version).toBe("0.27.1");
  });

  it("should default to an empty override, so an app that says nothing gets git's answer", () => {
    const alepha = Alepha.create();

    defineConfig({})(alepha);

    expect(alepha.get(metaOptions)).toEqual({});
  });
});
