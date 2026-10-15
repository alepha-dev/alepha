import { $hook, Alepha, AlephaError } from "alepha";
import { describe, it } from "vitest";

import { HookNamePolicy } from "../helpers/HookNamePolicy.ts";

describe("hook name migration", () => {
  for (const [oldName, replacement] of Object.entries(HookNamePolicy.retired)) {
    it(`refuses ${oldName} at every public entry point`, async ({ expect }) => {
      const message = `Hook "${oldName}" was renamed to "${replacement}"`;
      const alepha = Alepha.create();
      expect(() => alepha.events.on(oldName as never, () => {})).toThrow(
        AlephaError,
      );
      expect(() => alepha.events.on(oldName as never, () => {})).toThrow(
        message,
      );
      class StaleListener {
        hook = $hook({ on: oldName as never, handler: () => {} });
      }
      expect(() => alepha.inject(StaleListener)).toThrow(message);
      await expect(
        alepha.events.emit(oldName as never, {} as never),
      ).rejects.toThrow(message);
      await expect(
        alepha.events.emit(oldName as never, {} as never, { catch: true }),
      ).rejects.toThrow(message);
    });
  }

  it("enforces names, phases and facts while preserving the explicit exceptions", ({
    expect,
  }) => {
    for (const name of [
      "configure",
      "start",
      "ready",
      "stop",
      "log:entry",
      "job:begin",
      "job:cancel",
      "form:reset",
      "cache:hit",
      "payments:captured",
      "capacitor:auth:signedOut",
      "react:server:render:begin",
      "myApp:task:run:before",
      "myApp:task:completed",
    ]) {
      expect(HookNamePolicy.isValid(name), name).toBe(true);
    }
    for (const name of [
      "echo",
      "my-hook:changed",
      "task:onRun:before",
      "task:beforeRun:after",
      "task:run",
      "task:running",
      "task:before",
      "one:two:three:four:before",
      "server:onRequest",
    ]) {
      expect(HookNamePolicy.isValid(name), name).toBe(false);
    }
    expect(() => HookNamePolicy.assertCurrent("constructor")).not.toThrow();
  });
});
