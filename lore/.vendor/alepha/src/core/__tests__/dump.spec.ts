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

  // Secret by default, and materialized as `true` rather than left absent: a
  // consumer writing `if (v.secret)` must get the SAFE answer for a var nobody
  // annotated. Absent would be falsy, so the naive reader would expose it.
  it("reports env fields as secret unless declassified", () => {
    class Payments {
      env = $env(
        z.object({
          STRIPE_SECRET_KEY: z.text({ secret: true }),
          UNANNOTATED: z.text(),
          PUBLIC_URL: z.text({ secret: false }),
        }),
      );
    }

    const Mod = $module({ name: "payments", services: [Payments] });
    const alepha = Alepha.create({
      env: {
        STRIPE_SECRET_KEY: "sk_test",
        UNANNOTATED: "x",
        PUBLIC_URL: "https://x.dev",
      },
    }).with(Mod);

    const dump = alepha.dump();

    expect(dump.env.STRIPE_SECRET_KEY.secret).toBe(true);
    // Never annotated — treated exactly like an explicit `true`, because that
    // is already what the deploy path does with every declared key.
    expect(dump.env.UNANNOTATED.secret).toBe(true);
    // Only an explicit opt-out declassifies.
    expect(dump.env.PUBLIC_URL.secret).toBe(false);
  });

  // `.meta()` binds to the schema it was called on, so on an optional field the
  // opt-out sits on the INNER schema — the same trap `description` already has.
  // Losing it here would silently re-classify a declassified var as secret.
  it("reports the declassifying opt-out through .optional() and .meta()", () => {
    class Mixed {
      env = $env(
        z.object({
          OPTIONAL_PUBLIC: z.text({ secret: false }).optional(),
          META_PUBLIC: z.text().meta({ secret: false }),
        }),
      );
    }

    const Mod = $module({ name: "mixed", services: [Mixed] });
    const dump = Alepha.create({ env: { META_PUBLIC: "v" } })
      .with(Mod)
      .dump();

    expect(dump.env.OPTIONAL_PUBLIC.secret).toBe(false);
    expect(dump.env.META_PUBLIC.secret).toBe(false);
  });

  // `alepha gen env` annotates "(required)" straight off this flag. It used to
  // have to compensate by hand (`required && !default`) because every defaulted
  // variable was reported required - and a falsy default like `0` or `""` slipped
  // through the compensation anyway.
  it("reports a defaulted env variable as not required", () => {
    class Ports {
      env = $env(
        z.object({
          MUST_BE_SET: z.text(),
          HAS_A_DEFAULT: z.integer().default(3000),
          FALSY_DEFAULT: z.integer().default(0),
          OPTIONAL: z.text().optional(),
        }),
      );
    }

    const Mod = $module({ name: "ports", services: [Ports] });
    const dump = Alepha.create({ env: { MUST_BE_SET: "v" } })
      .with(Mod)
      .dump();

    expect(dump.env.MUST_BE_SET.required).toBe(true);
    expect(dump.env.HAS_A_DEFAULT.required).toBeUndefined();
    expect(dump.env.FALSY_DEFAULT.required).toBeUndefined();
    expect(dump.env.OPTIONAL.required).toBeUndefined();
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
