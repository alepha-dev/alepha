import { Alepha, type RunOptions, z } from "alepha";
import { describe, expectTypeOf, it } from "vitest";

import { run as nativeRun } from "../index.native.ts";
import { run as workerdRun } from "../index.workerd.ts";

describe("host-owned runtime entry points", () => {
  it("advertises only environment options", () => {
    expectTypeOf<Parameters<typeof nativeRun>[1]>().toEqualTypeOf<
      Pick<RunOptions, "env"> | undefined
    >();
    expectTypeOf<Parameters<typeof workerdRun>[1]>().toEqualTypeOf<
      Pick<RunOptions, "env"> | undefined
    >();
  });

  for (const [name, run] of [
    ["native", nativeRun],
    ["workerd", workerdRun],
  ] as const) {
    it(`honors ${name} env for service entries and existing containers`, ({
      expect,
    }) => {
      const previous = Object.getOwnPropertyDescriptor(globalThis, "__alepha");
      try {
        class App {}
        const created = run(App, { env: { RUN_MARKER: "created" } });
        expect(created.env.RUN_MARKER).toBe("created");
        expect(created.has(App)).toBe(true);
        const existing = Alepha.create({ env: { RUN_MARKER: "before" } });
        const schema = z.object({ RUN_MARKER: z.text() });
        expect(existing.parseEnv(schema).RUN_MARKER).toBe("before");
        const result = run(existing, {
          env: { RUN_MARKER: "after", RUN_NUMBER: 7, RUN_BOOLEAN: true },
        });
        expect(result).toBe(existing);
        expect(result.env.RUN_MARKER).toBe("after");
        expect(result.env.RUN_NUMBER).toBe(7);
        expect(result.env.RUN_BOOLEAN).toBe(true);
        expect(existing.parseEnv(schema).RUN_MARKER).toBe("after");
        if (name === "workerd") {
          expect((globalThis as { __alepha?: Alepha }).__alepha).toBe(existing);
        }
      } finally {
        if (previous) Object.defineProperty(globalThis, "__alepha", previous);
        else Reflect.deleteProperty(globalThis, "__alepha");
      }
    });
  }
});
