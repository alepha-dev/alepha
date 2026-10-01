import { $hook, Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { $interval } from "../index.ts";

describe("$interval across a failed start", () => {
  it("keeps its period when the app is started again", async () => {
    let ticks = 0;
    let failOnce = true;

    class App {
      loop = $interval({
        duration: [1, "hour"],
        handler: () => {
          ticks += 1;
        },
      });

      boot = $hook({
        on: "start",
        handler: () => {
          if (failOnce) {
            failOnce = false;
            throw new Error("first boot fails");
          }
        },
      });
    }

    const alepha = Alepha.create();
    alepha.inject(App);

    // The hook's own message: `start()` used to wrap a failing hook, and no
    // longer does, so what a caller sees is what the hook threw.
    await expect(alepha.start()).rejects.toThrow("first boot fails");
    await alepha.start();

    // The `stop` emitted by the failed boot used to zero the period, so the
    // re-armed timer was a `setInterval(run, 0)` hot loop.
    const settled = ticks;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ticks).toBe(settled);

    await alepha.stop();
  });
});
