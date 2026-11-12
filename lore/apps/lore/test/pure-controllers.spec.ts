import type { Alepha, Service } from "alepha";
import { describe, it } from "vitest";

/**
 * Every Lore class holding an action, a page or an MCP tool is a pure
 * controller (#Q3404): no `$hook` or other boot primitive, injected by nothing
 * but other pure controllers, and creating no boot class on its own. A pure
 * controller is created on its first request in production; anything else is
 * created at boot, on every cold start.
 *
 * Read the way `alepha build` reads it: the server entry imported with
 * `ALEPHA_CLI_IMPORT`, loaded and never started. A failure names the class
 * and why, which is what to fix:
 *
 * - a hook or a boot primitive (`$storage`, `$permission`, ...) moves to a
 *   class the module lists;
 * - a service holding the controller as a field resolves it where it calls it,
 *   with `this.alepha.inject(Controller)`;
 * - a module registers a controller with `services` or `alepha.with`, never
 *   `alepha.inject` in `register`.
 */
describe("Lore's controllers", () => {
  it("are all pure", { timeout: 120_000 }, async ({ expect }) => {
    const previous = process.env.ALEPHA_CLI_IMPORT;
    process.env.ALEPHA_CLI_IMPORT = "true";
    try {
      await import("../src/main.server.ts");
    } finally {
      if (previous === undefined) delete process.env.ALEPHA_CLI_IMPORT;
      else process.env.ALEPHA_CLI_IMPORT = previous;
    }
    const alepha = (globalThis as { __cli_alepha?: Alepha }).__cli_alepha!;

    const holders = new Set<Service>();
    for (const kind of ["$action", "$page", "$tool"]) {
      for (const primitive of alepha.primitives(kind)) {
        holders.add(primitive.config.service as Service);
      }
    }
    const notPure = alepha
      .purity()
      .filter((it) => holders.has(it.service) && !it.pure)
      .map((it) => `${it.service.name}: ${it.reasons.join("; ")}`);

    expect(holders.size).toBeGreaterThan(100);
    expect(notPure).toEqual([]);
  });
});
