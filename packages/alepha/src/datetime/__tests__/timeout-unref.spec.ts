import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { DateTimeProvider } from "../providers/DateTimeProvider.ts";

/**
 * A timeout holds the event loop open until it fires, which is right for work
 * and wrong for housekeeping. `alepha lore quality push` finished its push in
 * 3 seconds and then sat there for 5 minutes, because one cached GET had armed
 * a refed eviction timer for the 300s default TTL.
 *
 * `hasRef()` is Node's own answer to "would this keep the process alive", so
 * these assert the thing that actually matters rather than a flag we set.
 */
describe("unrefed timeouts", () => {
  const create = () => {
    const alepha = Alepha.create();
    return alepha.inject(DateTimeProvider);
  };

  it("should keep the event loop open by default", async ({ expect }) => {
    const time = create();

    const timeout = time.createTimeout(() => {}, [10, "second"]);

    expect(timeout.timer.hasRef()).toBe(true);

    timeout.clear();
  });

  it("should release the event loop when asked to", async ({ expect }) => {
    const time = create();

    const timeout = time.createTimeout(() => {}, [10, "second"], undefined, {
      unref: true,
    });

    expect(timeout.timer.hasRef()).toBe(false);

    timeout.clear();
  });

  it("should still fire an unrefed timeout", async ({ expect }) => {
    const time = create();

    let fired = false;
    time.createTimeout(
      () => {
        fired = true;
      },
      [20, "millisecond"],
      undefined,
      { unref: true },
    );

    await time.wait(100);
    expect(fired).toBe(true);
  });

  /**
   * The regression this file exists for. `unref` is a property of the handle,
   * and `travel()` throws the handle away and arms a new one — so a flag held
   * anywhere but on the timeout itself silently refs the timer again, and the
   * process it was meant to release stays alive.
   */
  it("should stay unrefed after travel() re-arms it", async ({ expect }) => {
    const time = create();

    const timeout = time.createTimeout(() => {}, [10, "minute"], undefined, {
      unref: true,
    });

    await time.travel([1, "minute"]);

    expect(timeout.timer.hasRef()).toBe(false);

    timeout.clear();
  });

  /**
   * Same hazard, one level down: a delay past the 32-bit limit is chained in
   * hops, and every hop is a fresh handle.
   */
  it("should stay unrefed across the hops of a far-future timeout", async ({
    expect,
  }) => {
    const time = create();

    const timeout = time.createTimeout(() => {}, [60, "day"], undefined, {
      unref: true,
    });

    expect(timeout.timer.hasRef()).toBe(false);

    // Past the first hop's expiry, which re-arms the chain.
    await time.travel([30, "day"]);

    expect(timeout.timer.hasRef()).toBe(false);

    timeout.clear();
  });
});
