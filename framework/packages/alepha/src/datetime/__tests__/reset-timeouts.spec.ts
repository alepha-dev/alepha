import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { DateTimeProvider } from "../index.ts";

describe("reset() and pending timeouts", () => {
  it("keeps the time a timeout was travelled, so a later travel() fires it", async () => {
    const dt = Alepha.create().inject(DateTimeProvider);
    let fired = 0;

    dt.createTimeout(() => {
      fired += 1;
    }, [10, "minutes"]);

    await dt.travel([5, "minutes"]);
    dt.reset();

    // Five minutes are left. The clock jumped back five minutes on reset(),
    // and counting that jump as negative elapsed time gave them back.
    await dt.travel([6, "minutes"]);

    expect(fired).toBe(1);
  });

  it("does not fire early a timeout that still has time left after reset()", async () => {
    const dt = Alepha.create().inject(DateTimeProvider);
    let fired = 0;

    const timeout = dt.createTimeout(() => {
      fired += 1;
    }, [10, "minutes"]);

    await dt.travel([5, "minutes"]);
    dt.reset();

    await dt.travel([4, "minutes"]);
    expect(fired).toBe(0);

    await dt.travel([2, "minutes"]);
    expect(fired).toBe(1);

    dt.clearTimeout(timeout);
  });

  it("counts the real time spent paused, as the real timer does", async () => {
    const dt = Alepha.create().inject(DateTimeProvider);
    let fired = 0;

    const timeout = dt.createTimeout(() => {
      fired += 1;
    }, 1000);

    dt.pause();
    await new Promise((resolve) => setTimeout(resolve, 150));
    dt.reset();

    // At least 100 ms of real time went by under the pause: 900 ms more is
    // past the expiry.
    await dt.travel(900);
    expect(fired).toBe(1);

    dt.clearTimeout(timeout);
  });

  it("counts the real time spent between a travel() and reset()", async () => {
    const dt = Alepha.create().inject(DateTimeProvider);
    let fired = 0;

    const timeout = dt.createTimeout(() => {
      fired += 1;
    }, 1000);

    await dt.travel(100);
    await new Promise((resolve) => setTimeout(resolve, 150));
    dt.reset();

    // 100 ms travelled, at least 100 ms of real time, 800 ms more.
    await dt.travel(800);
    expect(fired).toBe(1);

    dt.clearTimeout(timeout);
  });

  // A guard, not a regression: it held before reset() touched timeouts, and
  // refuses a reset() that counts elapsed time twice or on every call.
  it("does not count elapsed time twice across a pause and two resets", async () => {
    const dt = Alepha.create().inject(DateTimeProvider);
    let fired = 0;

    const timeout = dt.createTimeout(() => {
      fired += 1;
    }, [10, "minutes"]);

    dt.pause();
    dt.reset();
    dt.reset();

    await dt.travel([9, "minutes"]);
    expect(fired).toBe(0);

    await dt.travel([2, "minutes"]);
    expect(fired).toBe(1);

    dt.clearTimeout(timeout);
  });
});
