import { writeFileSync } from "node:fs";

import { $hook, AlephaError, run } from "alepha";
import { $route, AlephaServer } from "alepha/server";

/**
 * A production app for the real-Worker spec, steered by FIXTURE_MODE.
 */
class FixtureApp {
  protected readonly hello = $route({
    path: "/hello",
    handler: () => "hello from the worker",
  });

  protected readonly crash = $route({
    path: "/crash",
    handler: () => {
      setTimeout(() => {
        throw new AlephaError("injected runtime crash");
      }, 10);
      return "crashing";
    },
  });

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      if (process.env.FIXTURE_MODE === "boot-fail") {
        throw new AlephaError("injected startup failure");
      }
      if (process.env.FIXTURE_MODE === "hang-start") {
        await new Promise(() => {});
      }
    },
  });

  protected readonly onStop = $hook({
    on: "stop",
    handler: async () => {
      if (process.env.FIXTURE_MODE === "hang-stop") {
        await new Promise(() => {});
      }
      if (process.env.FIXTURE_MARKER) {
        writeFileSync(process.env.FIXTURE_MARKER, "stopped");
      }
    },
  });
}

if (process.env.FIXTURE_MODE !== "no-run") {
  run([AlephaServer, FixtureApp], {
    env:
      process.env.FIXTURE_MODE === "fixed-port"
        ? { SERVER_PORT: 3000 }
        : process.env.FIXTURE_MODE === "public-host"
          ? { SERVER_HOST: "0.0.0.0" }
          : undefined,
    once: process.env.FIXTURE_MODE === "once",
    configure: (alepha) => {
      alepha.store.set("fixture.configured" as any, true);
    },
    ready: (alepha) => {
      if (!alepha.store.get("fixture.configured" as any)) {
        throw new AlephaError("ready ran before configure");
      }
      if (!(globalThis as any).__fixtureWrapperDone) {
        throw new AlephaError("start ran before the entry wrapper finished");
      }
    },
  });
}
