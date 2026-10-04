import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { AlephaInspector } from "../index.ts";
import { DevLogStoreProvider } from "../providers/DevLogStoreProvider.ts";
import { InspectorRoutes } from "../providers/InspectorRoutes.ts";

/**
 * The inspector reads and MUTATES application state and serves the env in
 * cleartext, so where it registers is a security property, not a convenience.
 */
describe("AlephaInspector: where it registers", () => {
  const boot = (env: Record<string, string>) =>
    Alepha.create({ env }).with(AlephaInspector);

  it("registers in development", () => {
    const alepha = boot({ NODE_ENV: "development" });

    expect(alepha.has(InspectorRoutes)).toBe(true);
    expect(alepha.has(DevLogStoreProvider)).toBe(true);
  });

  it("does NOT register in production", () => {
    const alepha = boot({ NODE_ENV: "production", APP_SECRET: "test-secret" });

    expect(alepha.has(InspectorRoutes)).toBe(false);
    expect(alepha.has(DevLogStoreProvider)).toBe(false);
  });

  it("does NOT register under test", () => {
    // Every vitest suite would otherwise run a log persister and, once the run
    // registry lands, write entries and open sockets on the machine.
    const alepha = boot({ NODE_ENV: "test" });

    expect(alepha.has(InspectorRoutes)).toBe(false);
  });

  it("registers under test or production when ALEPHA_INSPECT=1 asks for it", () => {
    expect(
      boot({ NODE_ENV: "test", ALEPHA_INSPECT: "1" }).has(InspectorRoutes),
    ).toBe(true);
    expect(
      boot({
        NODE_ENV: "production",
        APP_SECRET: "test-secret",
        ALEPHA_INSPECT: "true",
      }).has(InspectorRoutes),
    ).toBe(true);
  });

  it("ignores any other value of ALEPHA_INSPECT", () => {
    const alepha = boot({
      NODE_ENV: "production",
      APP_SECRET: "test-secret",
      ALEPHA_INSPECT: "0",
    });

    expect(alepha.has(InspectorRoutes)).toBe(false);
  });
});
