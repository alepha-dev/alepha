import { createE2ePortAllocator } from "alepha/testing/playwright";

/**
 * One slot per Playwright config in this repository, which is what makes an
 * intra-checkout collision impossible rather than unlikely.
 *
 * This is the half of e2e port allocation that is ours rather than the
 * framework's: the mechanism (band, stride, checkout-hash derivation, bind
 * probe, per-worker walk) lives in `alepha/testing/playwright` and knows
 * nothing about which suites exist, while the names below are this
 * repository's business and must never ship to a consumer.
 *
 * An explicit registry cannot drift: a new suite either appears here or does
 * not typecheck. The previous scheme derived the slot from the app's dev port
 * (`default % 100`) and so depended on two unrelated numbers staying
 * coordinated by comment.
 *
 * Slots 2 and 9 are free. Past that, raise the band's `stride`.
 *
 * ⚠️ Numbers are not reshuffled when a suite goes away. Slot 2 was
 * `apps/examples/playground`, retired once `apps/ui` replaced it; renumbering
 * the survivors would move every other suite's derived port for no gain.
 */
export const E2E_SLOTS = {
  docs: 0,
  lore: 1,
  shop: 3,
  ssr: 4,
  "ssr-dev": 5,
  ui: 6,
  // The Bay end-to-end (apps/e2e-cli/src/bay.e2e.spec.ts) boots two servers:
  // a Lore instance and a Bay proxy, one slot each.
  bay: 7,
  "bay-proxy": 8,
} as const;

export type E2eApp = keyof typeof E2E_SLOTS;

/**
 * The e2e port for one suite, shared by every Playwright config in the repo.
 *
 * Same reasoning as `vitest.projects.ts`: a setting that must hold across six
 * configs lives in one place, and a caller contributes nothing but its own
 * name.
 *
 * **An e2e port is never a dev port.** Until this was rewritten the two were
 * literally the same number: `apps/docs` served dev on 3302 and ran e2e on
 * 3302, lore on 3303 and 3303, and so on down the band. With
 * `reuseExistingServer` on, `yarn dev` in one terminal and `yarn e2e` in
 * another meant Playwright quietly adopted the DEV server and ran the whole
 * suite against it: hot-reloaded sources instead of `node dist`, the dev
 * database instead of `:memory:`, and a green report either way. The bands are
 * now disjoint, so that particular lie is unreachable:
 *
 * | band          | who owns it                                              |
 * |---------------|----------------------------------------------------------|
 * | 3300-3399     | dev servers (`dev.port` in each `alepha.config.ts`)       |
 * | 5173+         | dev servers with no `dev.port` (Vite default, multi-app)  |
 * | 11883/15432/16379/19090 | `compose.yml` test services                     |
 * | **4300-4999** | **e2e, and nothing else**                                 |
 *
 * Nothing else in the repo may allocate inside the e2e band. The answer is
 * memoised through `E2E_PORT`, so a suite calling this from both its config
 * and its setup gets the same port twice (`apps/e2e-cli/src/bay.e2e.spec.ts`
 * depends on exactly that), and `E2E_PORT` set by hand overrides the whole
 * thing.
 *
 * @param app the suite's key in {@link E2E_SLOTS}.
 */
export const e2ePort = createE2ePortAllocator(E2E_SLOTS);

/**
 * A port for ONE Playwright worker of a suite that boots a server per worker.
 *
 * `apps/lore` does: each worker boots its own instance on its own in-memory
 * database, which is what lets its specs run `fullyParallel` (see
 * `apps/lore/e2e/_fixtures.ts`). Never memoised; see
 * `E2ePortAllocator.worker`.
 */
export const e2eWorkerPort = (app: E2eApp, workerIndex: number): number =>
  e2ePort.worker(app, workerIndex);

export const E2E_BAND_START = e2ePort.band.start;
export const E2E_BAND_END = e2ePort.band.end;

/**
 * Every port a suite would accept for a given checkout, best first.
 *
 * Re-exported bound to {@link E2E_SLOTS} so this repository's own test can
 * assert the arithmetic against this repository's dev-port bands.
 */
export const candidatePorts = (root: string, app: E2eApp): number[] =>
  e2ePort.candidates(root, app);
