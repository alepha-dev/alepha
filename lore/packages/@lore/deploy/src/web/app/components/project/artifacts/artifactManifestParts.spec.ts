import { describe, it } from "vitest";

import { artifactManifestParts } from "./artifactManifestParts.ts";
import { cronReading } from "./cronReading.ts";

const manifest = () => ({
  manifestVersion: 2,
  project: "acme",
  runtimes: [
    { runtime: "node", entry: "index.node.js", runtimeVersion: "26" },
    { runtime: "workerd", entry: "index.workerd.js" },
  ],
  resources: { hasDatabase: true, hasBucket: false, hasKV: true },
  crons: ["*/5 * * * *", "0 3 * * *"],
  secrets: [{ name: "STRIPE_KEY", description: "The live key." }],
  variables: [{ name: "APP_URL" }],
  cloudflare: { websocketPaths: ["/ws"], config: { name: "acme" } },
});

describe("artifactManifestParts", () => {
  it("cuts a manifest into its sections, with nothing left over", ({
    expect,
  }) => {
    const parts = artifactManifestParts(manifest());

    expect(parts.build).toEqual([
      { name: "project", value: "acme" },
      { name: "manifestVersion", value: "2" },
    ]);
    expect(parts.runtimes).toEqual([
      { runtime: "node", entry: "index.node.js", version: "26" },
      { runtime: "workerd", entry: "index.workerd.js", version: undefined },
    ]);
    expect(parts.resources).toEqual([
      { name: "database", on: true },
      { name: "bucket", on: false },
      { name: "kv", on: true },
    ]);
    expect(parts.crons).toEqual(["*/5 * * * *", "0 3 * * *"]);
    expect(parts.secrets).toEqual([
      { name: "STRIPE_KEY", description: "The live key." },
    ]);
    expect(parts.variables).toEqual([
      { name: "APP_URL", description: undefined },
    ]);
    expect(parts.websocketPaths).toEqual(["/ws"]);
    expect(parts.cloudflare).toEqual({ config: { name: "acme" } });
    expect(parts.other).toBeUndefined();
  });

  it("keeps every key it does not draw, top level and nested", ({ expect }) => {
    const parts = artifactManifestParts({
      ...manifest(),
      image: { base: "node:26" },
      futureFlag: true,
      runtimes: [{ runtime: "node", sandbox: "strict" }, "what is this"],
      resources: { hasDatabase: true, hasVectors: { dimensions: 768 } },
      secrets: [{ name: "STRIPE_KEY", rotation: "90d" }, { label: "nameless" }],
      crons: ["0 3 * * *", { every: "day" }],
    });

    expect(parts.other).toEqual({
      image: { base: "node:26" },
      futureFlag: true,
      runtimes: [{ sandbox: "strict", runtime: "node" }, "what is this"],
      resources: { hasVectors: { dimensions: 768 } },
      secrets: [{ rotation: "90d", name: "STRIPE_KEY" }, { label: "nameless" }],
      crons: [{ every: "day" }],
    });
    // And what it does draw is still drawn.
    expect(parts.runtimes.map((it) => it.runtime)).toEqual(["node"]);
    expect(parts.secrets.map((it) => it.name)).toEqual(["STRIPE_KEY"]);
  });

  it("reads a manifest with nothing in it", ({ expect }) => {
    expect(artifactManifestParts({})).toEqual({
      build: [],
      runtimes: [],
      resources: [],
      crons: [],
      secrets: [],
      variables: [],
      websocketPaths: [],
      cloudflare: undefined,
      other: undefined,
    });
  });
});

describe("cronReading", () => {
  it("reads the shapes a build declares", ({ expect }) => {
    const read = (expression: string) => {
      const reading = cronReading(expression);
      return reading && [reading.key.split(".").pop(), ...reading.args];
    };

    expect(read("* * * * *")).toEqual(["everyMinute"]);
    expect(read("*/5 * * * *")).toEqual(["everyMinutes", "5"]);
    expect(read("15 * * * *")).toEqual(["hourlyAt", "15"]);
    expect(read("0 */6 * * *")).toEqual(["everyHours", "6", "0"]);
    expect(read("5 3 * * *")).toEqual(["dailyAt", "03:05"]);
    expect(read("0 9 1 * *")).toEqual(["monthlyAt", "1", "09:00"]);
  });

  it("gives a weekly reading its day, Sunday as 0 or 7", ({ expect }) => {
    expect(cronReading("30 8 * * 1")).toMatchObject({
      key: "artifact.manifest.cron.weeklyAt",
      args: ["08:30"],
      weekday: 1,
    });
    expect(cronReading("0 0 * * 7")?.weekday).toBe(0);
  });

  it("says nothing rather than guess", ({ expect }) => {
    for (const expression of [
      "0 9 * * 1-5",
      "0 9,18 * * *",
      "0 0 1 1 *",
      "@daily",
      "0 0 * *",
      "0 9 15 * 1",
    ]) {
      expect(cronReading(expression)).toBeUndefined();
    }
  });
});
