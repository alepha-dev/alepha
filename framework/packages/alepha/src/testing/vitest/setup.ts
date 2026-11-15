/**
 * What jsdom does not implement, and every themed component expects.
 *
 * Loaded by `jsdomProject` for the whole browser test project, for the same
 * reason `execArgv` lives there: a shim added to one spec is a shim the next
 * one has to rediscover, and every config declaring a browser project would
 * otherwise have to restate it.
 */

/**
 * `window.matchMedia` is absent from jsdom entirely. Anything that asks the
 * platform a question about the viewport or the user's preferences reaches
 * for it on mount and throws — sonner's `<Toaster>` does, which is what makes
 * "did this action toast?" untestable without this.
 *
 * Everything reports as not matching: a test asserting on responsive or
 * reduced-motion behaviour should emulate it explicitly rather than inherit a
 * default from here.
 */
import { afterAll } from "vitest";

/**
 * Every timer a spec file left pending is cleared when the file ends, before
 * jsdom tears the window down.
 *
 * A toast closes on a 4-second timer, and React schedules its work through
 * `setImmediate`. A spec that ends sooner leaves those timers behind; if its
 * worker lives on to run another file, they fire after the window is gone and
 * throw `ReferenceError: window is not defined`. Vitest reports that as an
 * unhandled error attributed to the finished file and fails the run, with
 * every test green: `AdminWebhooks.browser.spec.tsx` in `@alepha/ui` and
 * `projectCrumbs.browser.spec.tsx` in Lore both turned `main` red that way.
 * It depends on which file the worker runs next, so it never reproduces alone
 * (#Q3679).
 *
 * The globals are wrapped here, in the setup file, so they are what React's
 * scheduler captures when it loads. A timer that fires or is cleared leaves
 * the set; what is left at `afterAll` belongs to nothing that can still be
 * asserted on.
 */
const pendingTimers = new Map<unknown, (handle: unknown) => void>();

const trackTimers = (
  setName: "setTimeout" | "setInterval" | "setImmediate",
  clearName: "clearTimeout" | "clearInterval" | "clearImmediate",
  once: boolean,
): void => {
  const scope = globalThis as unknown as Record<string, unknown>;
  const set = scope[setName];
  const clear = scope[clearName];
  if (typeof set !== "function" || typeof clear !== "function") {
    return;
  }
  const clearHandle = (handle: unknown) => {
    pendingTimers.delete(handle);
    clear.call(globalThis, handle);
  };
  const tracked = function (
    this: unknown,
    callback: unknown,
    ...rest: unknown[]
  ) {
    if (typeof callback !== "function") {
      return set.call(this, callback, ...rest);
    }
    let handle: unknown;
    const run = function (this: unknown, ...args: unknown[]) {
      if (once) {
        pendingTimers.delete(handle);
      }
      return callback.apply(this, args);
    };
    handle = set.call(this, run, ...rest);
    pendingTimers.set(handle, clearHandle);
    return handle;
  };
  // `util.promisify(setTimeout)` and the like read properties of the
  // original; carry them over.
  for (const key of Reflect.ownKeys(set)) {
    if (
      !["length", "name", "prototype", "arguments", "caller"].includes(
        String(key),
      )
    ) {
      const descriptor = Object.getOwnPropertyDescriptor(set, key);
      if (descriptor) {
        Object.defineProperty(tracked, key, descriptor);
      }
    }
  }
  scope[setName] = tracked;
  scope[clearName] = function (this: unknown, handle: unknown) {
    pendingTimers.delete(handle);
    return clear.call(this, handle);
  };
};

trackTimers("setTimeout", "clearTimeout", true);
trackTimers("setInterval", "clearInterval", false);
trackTimers("setImmediate", "clearImmediate", true);

afterAll(() => {
  // Deleting the entry being visited is safe while iterating a Map.
  for (const [handle, clearHandle] of pendingTimers) {
    clearHandle(handle);
  }
  pendingTimers.clear();
});

if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
