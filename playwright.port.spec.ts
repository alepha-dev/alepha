import { createServer, type Server } from "node:net";
import { afterEach, describe, it } from "vitest";
import {
  candidatePorts,
  E2E_BAND_END,
  E2E_BAND_START,
  E2E_SLOTS,
  type E2eApp,
  e2ePort,
} from "./playwright.port.ts";

const APPS = Object.keys(E2E_SLOTS) as E2eApp[];

/**
 * Every port a dev server can bind, which is the set an e2e port must never
 * intersect. 3300-3399 is the `dev.port` band in each app's `alepha.config.ts`
 * (docs 3302 … examples/ssr 3311); 5173+ is what an app WITHOUT a `dev.port`
 * gets from Vite, and what `alepha dev` hands each child in multi-app mode
 * (`5173 + index`). 3001-3004 is `apps/benchmark`, and the four high ports are
 * `compose.yml`.
 */
const RESERVED = new Set([
  ...range(3300, 3399),
  ...range(5173, 5199),
  ...range(3001, 3004),
  11883,
  15432,
  16379,
  19090,
]);

describe("candidatePorts", () => {
  it("never offers a port a dev server could be holding", ({ expect }) => {
    // The bug this whole band exists to kill: e2e ports used to BE the dev
    // ports (docs dev 3302 / e2e 3302, lore 3303 / 3303, …). With
    // `reuseExistingServer` on, a running `yarn dev` was adopted by the suite
    // and the run reported green against hot-reloaded sources and the dev
    // database. Assert the disjointness rather than trusting the comment.
    for (let i = 0; i < 200; i++) {
      for (const app of APPS) {
        for (const port of candidatePorts(`/tmp/checkout-${i}`, app)) {
          expect(RESERVED.has(port)).toBe(false);
        }
      }
    }
  });

  it("stays inside the reserved e2e band", ({ expect }) => {
    for (let i = 0; i < 200; i++) {
      for (const app of APPS) {
        for (const port of candidatePorts(`/tmp/some/checkout-${i}`, app)) {
          expect(port).toBeGreaterThanOrEqual(E2E_BAND_START);
          expect(port).toBeLessThanOrEqual(E2E_BAND_END);
        }
      }
    }
  });

  it("never collides two apps inside the same checkout, at any fallback depth", ({
    expect,
  }) => {
    // The old per-app-seeded hash made an intra-worktree collision a 1-in-500
    // per pair — and one real worktree hit it: shop (3305) and ssr
    // (3312) both derived 3638, so shop's server always held the port when
    // ssr's tried to bind, and `yarn v` failed deterministically while
    // each suite passed alone. Slots make that unreachable, but only if the
    // busy-port fallback preserves them: each app must step a whole stride, so
    // a suite fleeing a squatter never lands in a sibling's slot.
    for (let i = 0; i < 200; i++) {
      const lists = APPS.map((app) =>
        candidatePorts(`/home/user/git/alepha/.claude/worktrees/wt-${i}`, app),
      );
      for (let depth = 0; depth < lists[0].length; depth++) {
        const ports = lists.map((it) => it[depth]);
        expect(new Set(ports).size).toBe(APPS.length);
      }
      // Also across depths: app A's second choice must not be app B's first.
      expect(new Set(lists.flat()).size).toBe(lists.flat().length);
    }
  });

  it("separates two checkouts, which is what the probe cannot do", ({
    expect,
  }) => {
    // `yarn start` builds for a minute before it binds, so two runs started in
    // that window both probe the same port free. Only the checkout hash keeps
    // them apart — a formula that ignored the root would pass every other test
    // here and still let two agents share a server.
    const a = candidatePorts("/home/user/git/alepha", "lore")[0];
    const b = candidatePorts(
      "/home/user/git/alepha/.claude/worktrees/x",
      "lore",
    )[0];
    expect(a).not.toBe(b);
  });

  it("is stable for a given checkout, so a failing run can be re-attached to", ({
    expect,
  }) => {
    const root = "/home/user/git/alepha/.claude/worktrees/stable";
    expect(candidatePorts(root, "docs")).toEqual(candidatePorts(root, "docs"));
  });

  it("offers every base in the band as a fallback", ({ expect }) => {
    // A short candidate list would make the probe give up and return the busy
    // derived port — silently reintroducing the collision on a loaded machine.
    const ports = candidatePorts("/tmp/x", "docs");
    expect(ports.length).toBe((E2E_BAND_END + 1 - E2E_BAND_START) / 10);
    expect(new Set(ports).size).toBe(ports.length);
  });
});

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/**
 * The half a pure test cannot reach: `candidatePorts` can prove the arithmetic
 * avoids a dev port, but only a real socket proves the probe avoids a real
 * server. These bind for a few milliseconds inside the reserved e2e band, which
 * nothing else in the repo is allowed to allocate from.
 */
describe("e2ePort", () => {
  const held: Server[] = [];
  const saved = process.env.E2E_PORT;

  afterEach(async () => {
    await Promise.all(
      held.splice(0).map((s) => new Promise((r) => s.close(r))),
    );
    // `e2ePort` memoises into the environment, so a test that did not restore
    // it would hand its port to every test after it.
    if (saved === undefined) delete process.env.E2E_PORT;
    else process.env.E2E_PORT = saved;
  });

  const hold = async (port: number): Promise<void> => {
    const server = createServer();
    held.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, () => resolve());
    });
  };

  it("skips a port something is already listening on", async ({ expect }) => {
    delete process.env.E2E_PORT;
    const candidates = candidatePorts(process.cwd(), "docs");
    await hold(candidates[0]);

    const port = e2ePort("docs");

    expect(port).not.toBe(candidates[0]);
    expect(port).toBe(candidates[1]);
  });

  it("keeps stepping while ports stay busy", async ({ expect }) => {
    delete process.env.E2E_PORT;
    const candidates = candidatePorts(process.cwd(), "lore");
    await hold(candidates[0]);
    await hold(candidates[1]);

    expect(e2ePort("lore")).toBe(candidates[2]);
  });

  it("answers the same port twice, so global-setup agrees with the config", ({
    expect,
  }) => {
    delete process.env.E2E_PORT;
    const first = e2ePort("playground");
    expect(e2ePort("playground")).toBe(first);
    expect(process.env.E2E_PORT).toBe(String(first));
  });

  it("honours E2E_PORT without probing", ({ expect }) => {
    process.env.E2E_PORT = "4999";
    expect(e2ePort("docs")).toBe(4999);
  });
});
