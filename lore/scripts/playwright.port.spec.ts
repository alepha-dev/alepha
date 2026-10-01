import { describe, it } from "vitest";

import {
  candidatePorts,
  E2E_BAND_END,
  E2E_BAND_START,
  E2E_SLOTS,
  type E2eApp,
  e2eWorkerPort,
} from "./playwright.port.ts";

/**
 * The repository's own half of e2e port allocation.
 *
 * The mechanism is proved in `alepha/testing/playwright`'s own spec, against a
 * fixture registry: band containment, collision-freedom at every fallback
 * depth, checkout separation, the socket probe and the per-worker walk. None
 * of that needs to know which suites exist.
 *
 * What is left here is the part only this repository can assert, because only
 * this repository knows which ports its dev servers bind.
 */
const APPS = Object.keys(E2E_SLOTS) as E2eApp[];

/**
 * Every port a dev server can bind, which is the set an e2e port must never
 * intersect. 3300-3399 is the `dev.port` band in each app's
 * `alepha.config.ts` (docs 3302 … examples/ssr 3311); 5173+ is what an app
 * WITHOUT a `dev.port` gets from Vite, and what `alepha dev` hands each child
 * in multi-app mode (`5173 + index`). The four high ports are `compose.yml`.
 */
const RESERVED = new Set([
  ...range(3300, 3399),
  ...range(5173, 5199),
  11883,
  15432,
  16379,
  19090,
]);

describe("E2E_SLOTS", () => {
  it("never offers a port a dev server in this repo could be holding", ({
    expect,
  }) => {
    // The bug the band exists to kill: e2e ports used to BE the dev ports
    // (docs dev 3302 / e2e 3302, lore 3303 / 3303, …). With
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

  it("fits every suite inside one stride", ({ expect }) => {
    // Slots are added by hand, and one past the stride would wrap a suite onto
    // its neighbour's port rather than fail to compile.
    const slots = Object.values(E2E_SLOTS);
    expect(new Set(slots).size).toBe(slots.length);
    expect(Math.max(...slots)).toBeLessThan(10);
  });

  it("keeps the band this repo's port table advertises", ({ expect }) => {
    expect([E2E_BAND_START, E2E_BAND_END]).toEqual([4300, 4999]);
  });
});

describe("e2eWorkerPort", () => {
  it("hands lore's workers distinct ports inside lore's own slot", ({
    expect,
  }) => {
    const saved = process.env.E2E_PORT;
    delete process.env.E2E_PORT;
    try {
      const ports = Array.from({ length: 7 }, (_, i) =>
        e2eWorkerPort("lore", i),
      );
      expect(new Set(ports).size).toBe(ports.length);
      for (const port of ports) {
        expect(port % 10).toBe(E2E_SLOTS.lore);
        expect(RESERVED.has(port)).toBe(false);
      }
    } finally {
      if (saved !== undefined) process.env.E2E_PORT = saved;
    }
  });
});

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
