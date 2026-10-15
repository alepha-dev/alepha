import {
  $hook,
  $pipeline,
  Alepha,
  AlephaError,
  type AsyncLocalStorageData,
} from "alepha";
import { describe, expectTypeOf, it } from "vitest";

describe("public primitive contracts", () => {
  it("returns promises from synchronous pipeline calls and run", async ({
    expect,
  }) => {
    class App {
      double = $pipeline({ use: [], handler: (value: number) => value * 2 });
      fail = $pipeline({
        use: [],
        handler: () => {
          throw new AlephaError("refused");
        },
      });
    }
    const app = Alepha.create().inject(App);
    const called = app.double(2);
    const run = app.double.run(3);
    expect(called).toBeInstanceOf(Promise);
    expect(run).toBeInstanceOf(Promise);
    expect(await called).toBe(4);
    expect(await run).toBe(6);
    await expect(app.fail()).rejects.toThrow("refused");
    await expect(app.fail.run()).rejects.toThrow("refused");
    expectTypeOf<ReturnType<typeof app.double.run>>().toEqualTypeOf<
      Promise<number>
    >();
    expectTypeOf<AsyncLocalStorageData>().toEqualTypeOf<
      Record<string, unknown>
    >();
  });

  it("exposes the hook call count without allowing writes", async ({
    expect,
  }) => {
    class App {
      start = $hook({ on: "start", handler: () => {} });
    }
    const alepha = Alepha.create();
    const app = alepha.inject(App);
    expect(app.start.called).toBe(0);
    expect(Reflect.set(app.start, "called", 100)).toBe(false);
    await alepha.start();
    expect(app.start.called).toBe(1);
  });
});
