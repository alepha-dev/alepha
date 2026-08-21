import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { DateTimeProvider } from "../providers/DateTimeProvider.ts";

describe("timeouts beyond the 32-bit setTimeout limit", () => {
  const create = () => {
    const alepha = Alepha.create();
    return alepha.inject(DateTimeProvider);
  };

  it("should not fire a far-future timeout immediately", async () => {
    // setTimeout takes a 32-bit signed delay (~24.8 days max); Node clamps
    // anything larger to 1ms. A monthly cron on the 31st can be 61 days from
    // its next fire — without chaining, its tick fires instantly and loops.
    const time = create();

    let fired = false;
    const timeout = time.createTimeout(() => {
      fired = true;
    }, [60, "day"]);

    await time.wait(100);
    expect(fired).toBe(false);

    timeout.clear();
  });

  it("should not fire immediately after travel() re-registers a far-future timeout", async () => {
    const time = create();

    let fired = false;
    time.createTimeout(() => {
      fired = true;
    }, [60, "day"]);

    // travel() rewrites the remaining duration and re-arms the timer — the
    // re-armed delay (59 days) is still beyond the 32-bit limit.
    await time.travel([1, "day"]);

    await new Promise((r) => setTimeout(r, 100));
    expect(fired).toBe(false);
  });

  it("should fire a far-future timeout once travel() passes its expiry", async () => {
    const time = create();

    let fired = false;
    time.createTimeout(() => {
      fired = true;
    }, [60, "day"]);

    await time.travel([61, "day"]);
    expect(fired).toBe(true);
  });

  it("should cancel a chained far-future timeout via clear()", async () => {
    const time = create();

    let fired = false;
    const timeout = time.createTimeout(() => {
      fired = true;
    }, [60, "day"]);

    timeout.clear();

    await time.travel([61, "day"]);
    expect(fired).toBe(false);
  });
});

describe("intervals beyond the 32-bit setInterval limit", () => {
  const create = () => {
    const alepha = Alepha.create();
    return alepha.inject(DateTimeProvider);
  };

  it("should not spin a far-future interval immediately", async () => {
    // setInterval clamps like setTimeout: a period beyond ~24.8 days fires
    // every ~1ms instead — the handler spins continuously.
    const time = create();

    let calls = 0;
    const interval = time.createInterval(
      () => {
        calls++;
      },
      [30, "day"],
      true,
    );

    await time.wait(100);
    expect(calls).toBe(0);

    time.clearInterval(interval);
  });
});
