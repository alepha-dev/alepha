import { $hook, Alepha } from "alepha";
import { describe, expect, it } from "vitest";

class Database {}

describe("start() after a synchronous boot failure", () => {
  it("boots again instead of returning the cached rejection", async () => {
    let failOnce = true;
    let ready = false;

    // A constructor that throws fails boot() before its first await, which is
    // the path that used to leave a rejected promise cached in `startPromise`.
    class FlakyDatabase extends Database {
      constructor() {
        super();
        if (failOnce) {
          failOnce = false;
          throw new Error("ctor boom");
        }
      }
    }

    class App {
      onReady = $hook({
        on: "ready",
        handler: () => {
          ready = true;
        },
      });
    }

    const warnings: string[] = [];
    const alepha = Alepha.create().with({
      provide: Database,
      use: FlakyDatabase,
    });
    alepha.inject(App);
    alepha.events.on("log", (event) => {
      if (event.entry.level === "WARN") warnings.push(event.entry.message);
    });

    await expect(alepha.start()).rejects.toThrow("ctor boom");
    await alepha.start();

    expect(ready).toBe(true);
    expect(warnings).not.toContain(
      "App is already starting, waiting for it to finish...",
    );

    await alepha.stop();
  });
});
