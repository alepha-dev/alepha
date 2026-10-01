import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { BuildSlices } from "../services/BuildSlices.ts";

/**
 * The slice layout, and the one rule the whole multi-runtime artifact rests on
 * (epic #E63): the first declared runtime is the primary, and nothing sorts.
 */
describe("BuildSlices", () => {
  const slices = () => Alepha.create().inject(BuildSlices);

  describe("resolving the declared set", () => {
    it("defaults to node alone", ({ expect }) => {
      // The universal floor: the node slice runs under Node and under Bun.
      // workerd is Cloudflare-only and bun is an optimization, so neither
      // belongs in a default every app pays for.
      expect(slices().resolve(undefined)).toEqual(["node"]);
    });

    it("widens a scalar to a one-slice list", ({ expect }) => {
      expect(slices().resolve("workerd")).toEqual(["workerd"]);
    });

    /**
     * ⚠️ Two declarations of the same two runtimes, differing only in order,
     * must stay different. `["bun","node"]` deploys as bun and
     * `["node","bun"]` deploys as node, from byte-identical slice sets.
     */
    it("preserves order in both directions", ({ expect }) => {
      const s = slices();
      expect(s.resolve(["node", "bun"])).toEqual(["node", "bun"]);
      expect(s.resolve(["bun", "node"])).toEqual(["bun", "node"]);
    });

    it("drops a repeat and keeps the first occurrence", ({ expect }) => {
      // Keeping the LAST would let a duplicate further down move the primary,
      // which is the one thing order is supposed to decide.
      expect(slices().resolve(["node", "workerd", "node"])).toEqual([
        "node",
        "workerd",
      ]);
    });

    it("falls back to the default for an empty list", ({ expect }) => {
      expect(slices().resolve([])).toEqual(["node"]);
    });
  });

  describe("the --runtime flag", () => {
    it("parses a comma-separated list in order", ({ expect }) => {
      expect(slices().parseFlag("node,workerd")).toEqual(["node", "workerd"]);
    });

    it("tolerates spaces and a trailing comma", ({ expect }) => {
      expect(slices().parseFlag(" bun , node ,")).toEqual(["bun", "node"]);
    });

    it("answers undefined for nothing, so the config still wins", ({
      expect,
    }) => {
      // An empty flag value must not read as "an empty runtime set", which
      // would silently override a config that declared one.
      expect(slices().parseFlag(undefined)).toBeUndefined();
      expect(slices().parseFlag("")).toBeUndefined();
      expect(slices().parseFlag(",")).toBeUndefined();
    });
  });

  describe("where a slice lives", () => {
    it("names the entry wrapper after its runtime", ({ expect }) => {
      const s = slices();
      expect(s.entryFileName("node")).toBe("index.node.js");
      expect(s.entryFileName("workerd")).toBe("index.workerd.js");
      expect(s.entryFileName("bun")).toBe("index.bun.js");
    });

    /**
     * ⚠️ The namespacing is load-bearing. Two runtimes in one `server/` do not
     * collide — their content hashes differ — so both sets sit there, and
     * `wrangler.jsonc`'s `server/*.js` glob then sweeps the Node chunks into
     * the Worker upload.
     */
    it("gives each runtime its own chunk directory", ({ expect }) => {
      const s = slices();
      expect(s.serverDir("node")).toBe("server/node");
      expect(s.serverDir("workerd")).toBe("server/workerd");
      expect(s.serverDir("node")).not.toBe(s.serverDir("workerd"));
    });
  });

  describe("reading a build's resolved options", () => {
    it("prefers the resolved list over the declaration", ({ expect }) => {
      expect(
        slices().fromOptions({ runtime: "node", runtimes: ["bun", "node"] }),
      ).toEqual(["bun", "node"]);
    });

    it("falls back to the declaration when nothing was resolved", ({
      expect,
    }) => {
      // A spec, or the prebuilt path, may build the options by hand and never
      // go through BuildCommand.
      expect(slices().fromOptions({ runtime: ["node", "workerd"] })).toEqual([
        "node",
        "workerd",
      ]);
    });

    /**
     * ⚠️ `static` declares an app with NO server, so it resolves to no slices
     * at all rather than to a default. It is a declaration, never a slice, and
     * must never reach a `server/<runtime>/` path.
     */
    it("resolves a static declaration to no slices", ({ expect }) => {
      expect(slices().fromOptions({ runtime: "static" })).toEqual([]);
      expect(slices().isStaticBuild({ runtime: "static" })).toBe(true);
    });

    /**
     * There is no such thing as a half-static build: the static task strips
     * every server artifact out of `dist/`, so a slice declared beside it
     * would be built and then deleted.
     */
    it("treats static anywhere in the list as static", ({ expect }) => {
      expect(slices().resolve(["node", "static"])).toEqual([]);
      expect(slices().isStatic(["node", "static"])).toBe(true);
    });

    it("is not static when nothing says so", ({ expect }) => {
      expect(slices().isStaticBuild({ runtime: ["node", "workerd"] })).toBe(
        false,
      );
      expect(slices().isStaticBuild({})).toBe(false);
    });
  });

  it("names the first declared runtime as the primary", ({ expect }) => {
    const s = slices();
    expect(s.primary(["node", "workerd"])).toBe("node");
    expect(s.primary(["bun", "node"])).toBe("bun");
  });
});
