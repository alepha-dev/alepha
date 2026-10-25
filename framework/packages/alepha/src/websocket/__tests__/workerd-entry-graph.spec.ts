import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, it } from "vitest";

/**
 * The workerd entry (`index.workerd.ts`, selected by the `workerd` export
 * condition in a Cloudflare server build) must never reach the `ws` package:
 * server builds bundle with `noExternal: true`, and `ws`'s CommonJS modules
 * eagerly `require("events")`/`require("net")`/… at module scope — on
 * Cloudflare those requires go through the neutralized workerd
 * `createRequire`, so the worker dies during deploy-time script validation
 * (`Uncaught Error: createRequire is unavailable on workerd`) before it ever
 * serves a request. Only `NodeWebSocketServerProvider` imports `ws`, and a
 * workerd runtime can never use it, so the invariant is checked statically:
 * walk every relative import reachable from the workerd entry and assert the
 * `ws` specifier (and the Node provider that owns it) never appears.
 */
describe("websocket workerd entry", () => {
  const root = resolve(__dirname, "..");

  /**
   * Collect the transitive relative-import closure of a module, returning the
   * set of visited absolute file paths and every bare (package) specifier seen.
   */
  const walk = (entry: string) => {
    const visited = new Set<string>();
    const bare = new Set<string>();
    const queue = [entry];
    const importPattern =
      /(?:import|export)[^"'`;]*?from\s*["'`]([^"'`]+)["'`]/g;
    while (queue.length > 0) {
      const file = queue.pop();
      if (!file || visited.has(file)) continue;
      visited.add(file);
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(importPattern)) {
        const spec = match[1];
        if (spec.startsWith(".")) {
          queue.push(join(dirname(file), spec));
        } else {
          bare.add(spec);
        }
      }
    }
    return { visited, bare };
  };

  it("never reaches the ws package or the Node provider", ({ expect }) => {
    const { visited, bare } = walk(join(root, "index.workerd.ts"));
    expect(bare.has("ws")).toBe(false);
    const nodeProvider = [...visited].find((file) =>
      file.endsWith("NodeWebSocketServerProvider.ts"),
    );
    expect(nodeProvider).toBeUndefined();
  });
});
