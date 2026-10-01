import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

describe("Alepha#parseEnv", () => {
  it("should substitute $KEY placeholders in string values", async () => {
    const schema = z.object({
      HOST: z.text().optional(),
      PORT: z.text().optional(),
      BASE_URL: z.text().optional(),
    });

    const alepha = Alepha.create({
      env: {
        HOST: "localhost",
        PORT: "3000",
        BASE_URL: "http://$HOST:$PORT",
      },
    });

    const env = alepha.parseEnv(schema);
    expect(env.BASE_URL).toBe("http://localhost:3000");
  });

  it("should handle keys with regex-special characters", async () => {
    const schema = z.object({
      "API.URL": z.text().optional(),
      RESULT: z.text().optional(),
    });

    const alepha = Alepha.create({
      env: {
        "API.URL": "https://api.example.com",
        RESULT: "$API.URL/v1",
      },
    });

    const env = alepha.parseEnv(schema);
    expect(env.RESULT).toBe("https://api.example.com/v1");
  });

  it("should coerce non-string replacement sources", async () => {
    const schema = z.object({
      PORT: z.text().optional(),
      DEBUG: z.text().optional(),
      URL: z.text().optional(),
    });

    const alepha = Alepha.create({
      env: {
        PORT: 3000 as any,
        DEBUG: true as any,
        URL: "http://localhost:$PORT?debug=$DEBUG",
      },
    });

    const env = alepha.parseEnv(schema);
    expect(env.URL).toBe("http://localhost:3000?debug=true");
  });

  it("should leave unresolved placeholders as-is", async () => {
    const schema = z.object({
      URL: z.text().optional(),
    });

    const alepha = Alepha.create({
      env: { URL: "http://$MISSING/path" },
    });

    const env = alepha.parseEnv(schema);
    expect(env.URL).toBe("http://$MISSING/path");
  });

  it("should match env keys case-sensitively", async () => {
    const schema = z.object({
      HOST: z.text().optional(),
      URL: z.text().optional(),
    });

    const alepha = Alepha.create({
      env: { HOST: "localhost", URL: "$host" },
    });

    const env = alepha.parseEnv(schema);
    expect(env.URL).toBe("$host");
  });

  it("should resolve transitive $KEY references", async () => {
    const schema = z.object({
      A: z.text().optional(),
      B: z.text().optional(),
      C: z.text().optional(),
    });

    const alepha = Alepha.create({
      env: {
        A: "value",
        B: "$A",
        C: "$B",
      },
    });

    const env = alepha.parseEnv(schema);
    expect(env.B).toBe("value");
    expect(env.C).toBe("value");
  });

  it("should not replace substring keys when a longer key matches", async () => {
    const schema = z.object({
      PORT: z.text().optional(),
      PORT_NAME: z.text().optional(),
      URL: z.text().optional(),
    });

    const alepha = Alepha.create({
      env: {
        PORT: "3000",
        PORT_NAME: "http",
        URL: "$PORT_NAME://$PORT",
      },
    });

    const env = alepha.parseEnv(schema);
    expect(env.URL).toBe("http://3000");
  });

  it("should handle overlapping key prefixes correctly", async () => {
    const schema = z.object({
      A: z.text().optional(),
      AB: z.text().optional(),
      ABC: z.text().optional(),
      RESULT: z.text().optional(),
    });

    const alepha = Alepha.create({
      env: {
        A: "1",
        AB: "2",
        ABC: "3",
        RESULT: "$ABC-$AB-$A",
      },
    });

    const env = alepha.parseEnv(schema);
    expect(env.RESULT).toBe("3-2-1");
  });

  it("should return cached result for same schema", async () => {
    const schema = z.object({
      FOO: z.text().optional(),
    });

    const alepha = Alepha.create({
      env: { FOO: "bar" },
    });

    const first = alepha.parseEnv(schema);
    const second = alepha.parseEnv(schema);
    expect(first).toBe(second);
  });

  it("should keep '$$KEY' as a literal '$KEY' (escape)", async () => {
    const schema = z.object({
      PORT: z.text().optional(),
      PASSWORD: z.text().optional(),
    });

    const alepha = Alepha.create({
      env: { PORT: "3000", PASSWORD: "pre$$PORTpost" },
    });

    const env = alepha.parseEnv(schema);
    expect(env.PASSWORD).toBe("pre$PORTpost");
  });

  it("should keep '$$' before an undeclared key untouched", async () => {
    const schema = z.object({
      VALUE: z.text().optional(),
    });

    const alepha = Alepha.create({
      env: { VALUE: "$$MISSING" },
    });

    const env = alepha.parseEnv(schema);
    expect(env.VALUE).toBe("$$MISSING");
  });

  it("should keep an escape intact through transitive substitution", async () => {
    const schema = z.object({
      A: z.text().optional(),
      B: z.text().optional(),
      C: z.text().optional(),
    });

    const alepha = Alepha.create({
      env: {
        A: "secret",
        B: "$$A",
        C: "$B",
      },
    });

    const env = alepha.parseEnv(schema);
    expect(env.B).toBe("$A");
    // C resolves $B, whose escaped $$A must stay literal even though the
    // substitution introduced it mid-pass.
    expect(env.C).toBe("$A");
  });

  it("should not let regex metacharacters in keys break substitution", async () => {
    const schema = z.object({
      "MY(VAR)": z.text().optional(),
      "A+B": z.text().optional(),
      RESULT: z.text().optional(),
    });

    const alepha = Alepha.create({
      env: {
        "MY(VAR)": "one",
        "A+B": "two",
        RESULT: "$MY(VAR)/$A+B",
      },
    });

    const env = alepha.parseEnv(schema);
    expect(env.RESULT).toBe("one/two");
  });

  it("should not treat a dotted key as a regex wildcard", async () => {
    const schema = z.object({
      "API.URL": z.text().optional(),
      RESULT: z.text().optional(),
    });

    const alepha = Alepha.create({
      env: {
        "API.URL": "https://api.example.com",
        // "$APIXURL" must NOT be rewritten by the "API.URL" pattern.
        RESULT: "$APIXURL",
      },
    });

    const env = alepha.parseEnv(schema);
    expect(env.RESULT).toBe("$APIXURL");
  });

  describe("aliases", () => {
    const schema = z.object({
      SERVER_PORT: z
        .integer()
        .meta({ aliases: ["PORT", "HTTP_PORT"] })
        .default(3000),
    });

    it("should read the alias when the declared key is absent", () => {
      const alepha = Alepha.create({ env: { PORT: "8080" } });
      expect(alepha.parseEnv(schema).SERVER_PORT).toBe(8080);
    });

    it("should prefer the declared key over its aliases", () => {
      const alepha = Alepha.create({
        env: { SERVER_PORT: 4000, PORT: "8080" },
      });
      expect(alepha.parseEnv(schema).SERVER_PORT).toBe(4000);
    });

    it("should try aliases in the declared order", () => {
      const alepha = Alepha.create({
        env: { HTTP_PORT: "9090", PORT: "8080" },
      });
      expect(alepha.parseEnv(schema).SERVER_PORT).toBe(8080);
    });

    it("should fall through to a later alias when the first is absent", () => {
      const alepha = Alepha.create({ env: { HTTP_PORT: "9090" } });
      expect(alepha.parseEnv(schema).SERVER_PORT).toBe(9090);
    });

    it("should apply the default when neither key nor alias is set", () => {
      const alepha = Alepha.create({
        env: { SERVER_PORT: undefined, PORT: undefined, HTTP_PORT: undefined },
      });
      expect(alepha.parseEnv(schema).SERVER_PORT).toBe(3000);
    });

    it("should coerce and validate an aliased value as the declared key", () => {
      const alepha = Alepha.create({ env: { PORT: "not-a-port" } });
      expect(() => alepha.parseEnv(schema)).toThrow();
    });

    it("should expose the aliased value to $KEY substitution", () => {
      const withUrl = z.object({
        SERVER_PORT: z
          .integer()
          .meta({ aliases: ["PORT"] })
          .default(3000),
        URL: z.text().optional(),
      });

      const alepha = Alepha.create({
        env: { PORT: "8080", URL: "http://localhost:$SERVER_PORT" },
      });

      expect(alepha.parseEnv(withUrl).URL).toBe("http://localhost:8080");
    });

    it("should not make the alias a key of its own", () => {
      const alepha = Alepha.create({ env: { PORT: "8080" } });
      expect(alepha.parseEnv(schema)).not.toHaveProperty("PORT");
    });
  });

  it("should not interpret '$&' replacement patterns in values", async () => {
    const schema = z.object({
      PORT: z.text().optional(),
      URL: z.text().optional(),
    });

    const alepha = Alepha.create({
      env: { PORT: "3000", URL: "$PORT and $& stays" },
    });

    const env = alepha.parseEnv(schema);
    expect(env.URL).toBe("3000 and $& stays");
  });
});
