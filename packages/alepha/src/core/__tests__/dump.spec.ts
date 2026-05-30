import { $env, $module, Alepha, t } from "alepha";
import { describe, expect, it } from "vitest";

describe("Alepha.dump", () => {
  // Regression: dump() used to read `cacheEnv` BEFORE force-instantiating the
  // graph, so any service not already injected was missing from `env`. $env is
  // lazy (a key only exists once its service is constructed), so dump() must
  // force-inject first. This proves a registered-but-never-injected service's
  // env shows up.
  it("reports env from a registered service that was never injected", () => {
    class SecretService {
      env = $env(
        t.object({
          MY_SECRET: t.optional(t.text({ description: "a secret" })),
          MY_FLAG: t.optional(t.enum(["on", "off"])),
        }),
      );
    }

    const Mod = $module({ name: "secrets", services: [SecretService] });
    const alepha = Alepha.create({ env: { MY_SECRET: "shh" } }).with(Mod);

    // No `alepha.inject(SecretService)` — dump() must surface it on its own.
    const dump = alepha.dump();

    expect(dump.env.MY_SECRET).toBeDefined();
    expect(dump.env.MY_SECRET.description).toBe("a secret");
    expect(dump.env.MY_FLAG.enum).toEqual(["on", "off"]);
    // And the provider graph still lists the service.
    expect(dump.providers.SecretService).toBeDefined();
  });

  it("captures env from multiple independent services in one pass", () => {
    class A {
      env = $env(t.object({ A_KEY: t.optional(t.text()) }));
    }
    class B {
      env = $env(t.object({ B_KEY: t.optional(t.text()) }));
    }

    const Mod = $module({ name: "ab", services: [A, B] });
    const dump = Alepha.create().with(Mod).dump();

    expect(dump.env.A_KEY).toBeDefined();
    expect(dump.env.B_KEY).toBeDefined();
  });
});
