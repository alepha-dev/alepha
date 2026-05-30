import { $env, $inject, Alepha, AlephaError, TypeBoxError, t } from "alepha";
import { describe, expect, it } from "vitest";

describe("$env", () => {
  it("should parse env variables from Alepha config", () => {
    class App {
      env = $env(
        t.object({
          PORT: t.text(),
        }),
      );
    }

    const app = Alepha.create({ env: { PORT: "3000" } }).inject(App);
    expect(app.env.PORT).toBe("3000");
  });

  it("should apply default values when var is missing", () => {
    class App {
      env = $env(
        t.object({
          HOST: t.text({ default: "localhost" }),
        }),
      );
    }

    const app = Alepha.create().inject(App);
    expect(app.env.HOST).toBe("localhost");
  });

  it("should interpolate env references", () => {
    class App {
      env = $env(
        t.object({
          BASE: t.text(),
          URL: t.text({ default: "$BASE/api" }),
        }),
      );
    }

    const app = Alepha.create({ env: { BASE: "http://localhost" } }).inject(
      App,
    );
    expect(app.env.URL).toBe("http://localhost/api");
  });

  it("should throw TypeBoxError when required var is missing", () => {
    class App {
      env = $env(
        t.object({
          REQUIRED: t.text(),
        }),
      );
    }

    expect(() => Alepha.create().inject(App)).toThrow(TypeBoxError);
  });

  it("should throw AlephaError for non-TObject schema", () => {
    class App {
      env = $env(t.text() as any);
    }

    expect(() => Alepha.create().inject(App)).toThrow(AlephaError);
  });

  it("should share parsed env across services", () => {
    const schema = t.object({ KEY: t.text() });

    class A {
      env = $env(schema);
    }

    class B {
      a = $inject(A);
      env = $env(schema);
    }

    const alepha = Alepha.create({ env: { KEY: "value" } });
    const b = alepha.inject(B);

    expect(b.env.KEY).toBe("value");
    expect(b.a.env.KEY).toBe("value");
  });

  describe("loadEnv", () => {
    it("lifts string values from a runtime binding into alepha.env", () => {
      const alepha = Alepha.create();
      alepha.loadEnv({ PUBLIC_URL: "https://lore.alepha.dev" });

      expect(alepha.env.PUBLIC_URL).toBe("https://lore.alepha.dev");
    });

    it("skips non-string bindings (D1, R2, KV objects)", () => {
      const alepha = Alepha.create();
      alepha.loadEnv({
        PUBLIC_URL: "https://app.example.com",
        DB: { prepare: () => {} },
        BUCKET: { get: () => {} },
      });

      expect(alepha.env.PUBLIC_URL).toBe("https://app.example.com");
      expect(alepha.env.DB).toBeUndefined();
      expect(alepha.env.BUCKET).toBeUndefined();
    });

    it("does not clobber existing (explicit) env values", () => {
      const alepha = Alepha.create({ env: { PUBLIC_URL: "https://explicit" } });
      alepha.loadEnv({ PUBLIC_URL: "https://from-binding" });

      expect(alepha.env.PUBLIC_URL).toBe("https://explicit");
    });

    it("is resolvable through $env after merge", () => {
      class App {
        env = $env(t.object({ PUBLIC_URL: t.text({ default: "" }) }));
      }

      const alepha = Alepha.create();
      alepha.loadEnv({ PUBLIC_URL: "https://merged.example.com" });

      expect(alepha.inject(App).env.PUBLIC_URL).toBe(
        "https://merged.example.com",
      );
    });
  });
});
