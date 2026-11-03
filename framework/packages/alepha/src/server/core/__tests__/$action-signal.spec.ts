import { $hook, $inject, Alepha } from "alepha";
import { describe, it } from "vitest";

import { $action } from "../index.ts";

/**
 * What the hook and the handlers saw, for the assertions.
 */
class Probe {
  hooked?: AbortSignal;
  seen?: { request: AbortSignal; ambient: AbortSignal };
  listening = Promise.withResolvers<void>();
}

class Api {
  protected readonly alepha = $inject(Alepha);
  protected readonly probe = $inject(Probe);

  onRequest = $hook({
    on: "action:request:before",
    handler: ({ request }) => {
      this.probe.hooked = request.signal;
    },
  });

  peek = $action({
    method: "GET",
    path: "/peek",
    handler: ({ signal }) => {
      this.probe.seen = {
        request: signal,
        ambient: this.alepha.context.signal,
      };
      return "ok";
    },
  });

  /**
   * Answers with the reason its signal aborted with, once it does.
   */
  listen = $action({
    method: "GET",
    path: "/listen",
    handler: async ({ signal }) => {
      const aborted = new Promise((resolve) =>
        signal.addEventListener("abort", resolve, { once: true }),
      );
      this.probe.listening.resolve();
      await aborted;
      return signal.reason as string;
    },
  });
}

const start = async () => {
  const alepha = Alepha.create().with(Api);
  await alepha.start();
  return { alepha, api: alepha.inject(Api), probe: alepha.inject(Probe) };
};

describe("$action signal", () => {
  describe("on a local run()", () => {
    it("is the ambient signal, the app signal outside any unit of work", async ({
      expect,
    }) => {
      const { alepha, api, probe } = await start();

      await api.peek();

      expect(probe.seen?.request).toBeInstanceOf(AbortSignal);
      expect(probe.seen?.request).toBe(probe.seen?.ambient);
      expect(probe.seen?.request).toBe(alepha.context.signal);
    });

    it("aborts with the caller's signal", async ({ expect }) => {
      const { alepha, api, probe } = await start();
      const controller = new AbortController();

      const pending = alepha.context.withSignal(controller.signal, () =>
        api.listen(),
      );
      await probe.listening.promise;
      controller.abort("gone");

      expect(await pending).toBe("gone");
    });

    it("reaches an action:request:before hook", async ({ expect }) => {
      const { alepha, api, probe } = await start();

      await api.peek();

      expect(probe.hooked).toBe(alepha.context.signal);
    });
  });
});
