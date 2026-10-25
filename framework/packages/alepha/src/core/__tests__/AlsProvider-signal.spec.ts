import { $hook, AbortedError, Alepha, AlsProvider } from "alepha";
import { describe, it } from "vitest";

/**
 * The ambient signal (#E85): one AbortSignal per unit of work, read from the
 * context, falling back to the app signal.
 */
describe("AlsProvider signal", () => {
  it("answers the app signal outside any unit of work, and never undefined", ({
    expect,
  }) => {
    const alepha = Alepha.create();
    expect(alepha.context.signal).toBe(alepha.context.appSignal);
    expect(alepha.context.signal.aborted).toBe(false);
  });

  it("aborts the app signal as stop begins, before the stop hooks run", async ({
    expect,
  }) => {
    const seen: boolean[] = [];
    class Service {
      onStop = $hook({
        on: "stop",
        handler: (app) => {
          seen.push(app.context.appSignal.aborted);
        },
      });
    }
    const alepha = Alepha.create().with(Service);
    await alepha.start();
    const signal = alepha.context.appSignal;

    await alepha.stop();

    expect(seen).toEqual([true]);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBeInstanceOf(AbortedError);
    expect(alepha.context.isAbortError(signal.reason, signal)).toBe(true);
  });

  it("gives a container started again a fresh app signal", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    await alepha.start();
    await alepha.stop();
    expect(alepha.context.appSignal.aborted).toBe(true);

    await alepha.start();
    expect(alepha.context.appSignal.aborted).toBe(false);
  });

  it("reads the innermost layer's signal, walking up through nested layers", ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const controller = new AbortController();

    alepha.context.run(
      () => {
        expect(alepha.context.signal).toBe(controller.signal);
        alepha.context.nest(() => {
          expect(alepha.context.signal).toBe(controller.signal);
        });
      },
      { signal: controller.signal },
    );
  });

  it("does not compose a unit of work's signal with the app signal", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    await alepha.start();
    const controller = new AbortController();

    await alepha.context.run(
      async () => {
        const signal = alepha.context.signal;
        await alepha.stop();
        // The owner of the unit drains it, then aborts it at its deadline.
        expect(signal.aborted).toBe(false);
      },
      { signal: controller.signal },
    );
  });

  it("falls back to the app signal in an isolated context, never the caller's", ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const visitor = new AbortController();

    alepha.context.run(
      () => {
        alepha.context.runIsolated(() => {
          expect(alepha.context.signal).toBe(alepha.context.appSignal);
        });
      },
      { signal: visitor.signal },
    );
  });

  describe("withSignal", () => {
    it("aborts when the outer signal aborts", ({ expect }) => {
      const alepha = Alepha.create();
      const outer = new AbortController();
      const inner = new AbortController();

      alepha.context.run(
        () => {
          alepha.context.withSignal(inner.signal, () => {
            const signal = alepha.context.signal;
            expect(signal.aborted).toBe(false);
            outer.abort(new AbortedError("outer"));
            expect(signal.aborted).toBe(true);
            expect(signal.reason).toBe(outer.signal.reason);
          });
        },
        { signal: outer.signal },
      );
    });

    it("aborts when its own signal aborts, leaving the outer one alone", ({
      expect,
    }) => {
      const alepha = Alepha.create();
      const outer = new AbortController();
      const inner = new AbortController();

      alepha.context.run(
        () => {
          alepha.context.withSignal(inner.signal, () => {
            inner.abort();
            expect(alepha.context.signal.aborted).toBe(true);
          });
          expect(alepha.context.signal).toBe(outer.signal);
          expect(outer.signal.aborted).toBe(false);
        },
        { signal: outer.signal },
      );
    });

    it("can only narrow: an already aborted outer signal stays aborted", ({
      expect,
    }) => {
      const alepha = Alepha.create();
      const outer = new AbortController();
      outer.abort();

      alepha.context.run(
        () => {
          alepha.context.withSignal(new AbortController().signal, () => {
            expect(alepha.context.signal.aborted).toBe(true);
          });
        },
        { signal: outer.signal },
      );
    });
  });

  describe("detachSignal", () => {
    it("survives the caller's abort", async ({ expect }) => {
      const alepha = Alepha.create();
      const request = new AbortController();

      await alepha.context.run(
        async () => {
          const detached = alepha.context.detachSignal(
            () => alepha.context.signal,
          );
          request.abort(new AbortedError("Client disconnected"));
          expect(alepha.context.signal.aborted).toBe(true);
          expect(detached.aborted).toBe(false);
        },
        { signal: request.signal },
      );
    });

    it("still dies at app stop", async ({ expect }) => {
      const alepha = Alepha.create();
      await alepha.start();
      const detached = alepha.context.run(
        () => alepha.context.detachSignal(() => alepha.context.signal),
        { signal: new AbortController().signal },
      );

      await alepha.stop();

      expect(detached.aborted).toBe(true);
    });
  });

  describe("isAbortError", () => {
    it("recognises the signal's reason, an AbortedError and a DOMException AbortError", ({
      expect,
    }) => {
      const alepha = Alepha.create();
      const controller = new AbortController();
      const reason = new Error("custom reason");
      controller.abort(reason);

      expect(alepha.context.isAbortError(reason, controller.signal)).toBe(true);
      expect(alepha.context.isAbortError(new AbortedError("x"))).toBe(true);
      expect(
        alepha.context.isAbortError(new DOMException("gone", "AbortError")),
      ).toBe(true);
      expect(
        alepha.context.isAbortError(
          new Error("wrapped", { cause: new AbortedError("x") }),
        ),
      ).toBe(true);
    });

    it("does not mistake a real failure for an abort", ({ expect }) => {
      const alepha = Alepha.create();
      const controller = new AbortController();
      controller.abort(new AbortedError("elsewhere"));

      expect(
        alepha.context.isAbortError(new Error("boom"), controller.signal),
      ).toBe(false);
      expect(alepha.context.isAbortError(undefined)).toBe(false);
    });
  });

  describe("without AsyncLocalStorage (browser builds)", () => {
    it("answers the app signal, and withSignal / detachSignal call through", ({
      expect,
    }) => {
      const original = AlsProvider.create;
      AlsProvider.create = () => undefined;
      try {
        const context = new AlsProvider();
        expect(context.signal).toBe(context.appSignal);
        const inner = new AbortController();
        expect(context.withSignal(inner.signal, () => context.signal)).toBe(
          context.appSignal,
        );
        expect(context.detachSignal(() => 42)).toBe(42);
      } finally {
        AlsProvider.create = original;
      }
    });
  });
});
