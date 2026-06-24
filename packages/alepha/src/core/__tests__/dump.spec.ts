import { $env, $module, Alepha, z } from "alepha";
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
        z.object({
          MY_SECRET: z.text({ description: "a secret" }).optional(),
          MY_FLAG: z.enum(["on", "off"]).optional(),
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
      env = $env(z.object({ A_KEY: z.text().optional() }));
    }
    class B {
      env = $env(z.object({ B_KEY: z.text().optional() }));
    }

    const Mod = $module({ name: "ab", services: [A, B] });
    const dump = Alepha.create().with(Mod).dump();

    expect(dump.env.A_KEY).toBeDefined();
    expect(dump.env.B_KEY).toBeDefined();
  });
});
