import { createServer, type Server } from "node:net";

import { afterEach, describe, it } from "vitest";

import { createE2ePortAllocator, DEFAULT_E2E_BAND } from "../index.ts";

/**
 * A registry standing in for a consumer's own. Deliberately not this repo's
 * `E2E_SLOTS`: the mechanism must be provable without knowing which suites
 * happen to exist, and the repo's registry is asserted separately in
 * `playwright.port.spec.ts` against the dev-port bands only that repo knows.
 */
const SLOTS = { alpha: 0, beta: 1, gamma: 2, delta: 3 } as const;
const APPS = Object.keys(SLOTS) as Array<keyof typeof SLOTS>;

const allocator = createE2ePortAllocator(SLOTS);

describe("candidates", () => {
  it("stays inside the band", ({ expect }) => {
    for (let i = 0; i < 200; i++) {
      for (const app of APPS) {
        for (const port of allocator.candidates(`/tmp/checkout-${i}`, app)) {
          expect(port).toBeGreaterThanOrEqual(DEFAULT_E2E_BAND.start);
          expect(port).toBeLessThanOrEqual(DEFAULT_E2E_BAND.end);
        }
      }
    }
  });

  it("never collides two suites inside one checkout, at any fallback depth", ({
    expect,
  }) => {
    // A per-app-seeded hash made an intra-checkout collision a 1-in-500 per
    // pair, and one real worktree hit it: two suites derived the same port, so
    // one server always held it while the other tried to bind, and the
    // pipeline failed deterministically while each suite passed alone. Slots
    // make that unreachable, but only if the busy-port fallback preserves
    // them: each suite must step a whole stride, so one fleeing a squatter
    // never lands in a sibling's slot.
    for (let i = 0; i < 200; i++) {
      const lists = APPS.map((app) =>
        allocator.candidates(`/home/user/git/project/worktrees/wt-${i}`, app),
      );
      for (let depth = 0; depth < lists[0].length; depth++) {
        const ports = lists.map((it) => it[depth]);
        expect(new Set(ports).size).toBe(APPS.length);
      }
      // Also across depths: suite A's second choice must not be suite B's first.
      expect(new Set(lists.flat()).size).toBe(lists.flat().length);
    }
  });

  it("separates two checkouts, which is what the probe cannot do", ({
    expect,
  }) => {
    // A build takes a minute before it binds, so two runs started in that
    // window both probe the same port free. Only the checkout hash keeps them
    // apart: a formula that ignored the root would pass every other test here
    // and still let two agents share a server.
    const a = allocator.candidates("/home/user/git/project", "alpha")[0];
    const b = allocator.candidates(
      "/home/user/git/project/worktrees/x",
      "alpha",
    )[0];
    expect(a).not.toBe(b);
  });

  it("is stable for a given checkout, so a failing run can be re-attached to", ({
    expect,
  }) => {
    const root = "/home/user/git/project/worktrees/stable";
    expect(allocator.candidates(root, "alpha")).toEqual(
      allocator.candidates(root, "alpha"),
    );
  });

  it("offers every base in the band as a fallback", ({ expect }) => {
    // A short candidate list would make the probe give up and return the busy
    // derived port, silently reintroducing the collision on a loaded machine.
    const ports = allocator.candidates("/tmp/x", "alpha");
    const bases =
      (DEFAULT_E2E_BAND.end + 1 - DEFAULT_E2E_BAND.start) /
      DEFAULT_E2E_BAND.stride;
    expect(ports.length).toBe(bases);
    expect(new Set(ports).size).toBe(ports.length);
  });

  it("honours a custom band", ({ expect }) => {
    const custom = createE2ePortAllocator(SLOTS, {
      start: 5000,
      end: 5099,
      stride: 20,
    });
    expect(custom.band).toEqual({ start: 5000, end: 5099, stride: 20 });
    for (const port of custom.candidates("/tmp/x", "beta")) {
      expect(port).toBeGreaterThanOrEqual(5000);
      expect(port).toBeLessThanOrEqual(5099);
    }
  });
});

/**
 * The half a pure test cannot reach: the arithmetic can prove a candidate list
 * is disjoint, but only a real socket proves the probe avoids a real server.
 * These bind for a few milliseconds inside the default e2e band.
 */
describe("allocation", () => {
  const held: Server[] = [];
  const saved = process.env.E2E_PORT;

  afterEach(async () => {
    await Promise.all(
      held.splice(0).map((s) => new Promise((r) => s.close(r))),
    );
    // The allocator memoises into the environment, so a test that did not
    // restore it would hand its port to every test after it.
    if (saved === undefined) delete process.env.E2E_PORT;
    else process.env.E2E_PORT = saved;
  });

  const hold = async (port: number, host?: string): Promise<void> => {
    const server = createServer();
    held.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      if (host) {
        server.listen(port, host, () => resolve());
      } else {
        server.listen(port, () => resolve());
      }
    });
  };

  it("skips a port held on the loopback address only", async ({ expect }) => {
    // `wrangler dev` binds 127.0.0.1, and on macOS a wildcard bind succeeds
    // next to it, so a wildcard-only probe hands the suite the same port.
    delete process.env.E2E_PORT;
    const candidates = allocator.candidates(allocator.root(), "alpha");
    await hold(candidates[0], "127.0.0.1");

    expect(allocator("alpha")).toBe(candidates[1]);
  });

  it("skips a port something is already listening on", async ({ expect }) => {
    delete process.env.E2E_PORT;
    const candidates = allocator.candidates(allocator.root(), "alpha");
    await hold(candidates[0]);

    const port = allocator("alpha");

    expect(port).not.toBe(candidates[0]);
    expect(port).toBe(candidates[1]);
  });

  it("keeps stepping while ports stay busy", async ({ expect }) => {
    delete process.env.E2E_PORT;
    const candidates = allocator.candidates(allocator.root(), "beta");
    await hold(candidates[0]);
    await hold(candidates[1]);

    expect(allocator("beta")).toBe(candidates[2]);
  });

  it("answers the same port twice, so global-setup agrees with the config", ({
    expect,
  }) => {
    delete process.env.E2E_PORT;
    const first = allocator("gamma");
    expect(allocator("gamma")).toBe(first);
    expect(process.env.E2E_PORT).toBe(String(first));
  });

  it("honours E2E_PORT without probing", ({ expect }) => {
    process.env.E2E_PORT = "4999";
    expect(allocator("alpha")).toBe(4999);
  });
});

/**
 * A suite that boots one server per Playwright worker needs a port per worker
 * rather than one for the suite.
 */
describe("worker", () => {
  const held: Server[] = [];
  const saved = process.env.E2E_PORT;

  afterEach(async () => {
    await Promise.all(
      held.splice(0).map((s) => new Promise((r) => s.close(r))),
    );
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

  it("gives every worker of a run a different port", ({ expect }) => {
    delete process.env.E2E_PORT;

    const ports = Array.from({ length: 14 }, (_, i) =>
      allocator.worker("beta", i),
    );

    expect(new Set(ports).size).toBe(ports.length);
  });

  /**
   * ⚠️ The regression the first implementation shipped with. It rotated ONE
   * shared candidate list per worker, so a worker whose first choice was busy
   * advanced onto the base the next worker had started from and both took it:
   * 14 workers, 13 distinct ports. Disjoint subsequences make it impossible
   * rather than unlikely, so squatting some workers' first choices must not
   * affect uniqueness at all.
   */
  it("keeps workers disjoint even when first choices are taken", async ({
    expect,
  }) => {
    delete process.env.E2E_PORT;

    for (let i = 0; i < 4; i++) {
      await hold(allocator.worker("beta", i));
    }

    const ports = Array.from({ length: 8 }, (_, i) =>
      allocator.worker("beta", i),
    );

    expect(new Set(ports).size).toBe(ports.length);
  });

  it("stays in the suite's own slot, so no sibling suite is encroached on", ({
    expect,
  }) => {
    delete process.env.E2E_PORT;

    for (let i = 0; i < 14; i++) {
      const port = allocator.worker("gamma", i);
      expect(port % DEFAULT_E2E_BAND.stride).toBe(SLOTS.gamma);
      expect(port).toBeGreaterThanOrEqual(DEFAULT_E2E_BAND.start);
      expect(port).toBeLessThanOrEqual(DEFAULT_E2E_BAND.end);
    }
  });

  /**
   * ⚠️ The property the suite-wide allocation must NOT have here. It memoises
   * through `E2E_PORT` so a config and its global setup agree; doing that per
   * worker would hand the whole run one port.
   */
  it("does not memoise, so worker 1 is not handed worker 0's port", ({
    expect,
  }) => {
    delete process.env.E2E_PORT;

    const first = allocator.worker("beta", 0);

    expect(process.env.E2E_PORT).toBeUndefined();
    expect(allocator.worker("beta", 1)).not.toBe(first);
  });

  it("offsets E2E_PORT per worker, keeping the escape hatch usable", ({
    expect,
  }) => {
    process.env.E2E_PORT = "4900";

    expect(allocator.worker("beta", 0)).toBe(4900);
    expect(allocator.worker("beta", 3)).toBe(4903);
  });
});
