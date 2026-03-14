import { Alepha, t } from "alepha";
import { describe, expect, it } from "vitest";

describe("Alepha#parseEnv", () => {
  it("should substitute $KEY placeholders in string values", async () => {
    const schema = t.object({
      HOST: t.optional(t.text()),
      PORT: t.optional(t.text()),
      BASE_URL: t.optional(t.text()),
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
    const schema = t.object({
      "API.URL": t.optional(t.text()),
      RESULT: t.optional(t.text()),
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
    const schema = t.object({
      PORT: t.optional(t.text()),
      DEBUG: t.optional(t.text()),
      URL: t.optional(t.text()),
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
    const schema = t.object({
      URL: t.optional(t.text()),
    });

    const alepha = Alepha.create({
      env: { URL: "http://$MISSING/path" },
    });

    const env = alepha.parseEnv(schema);
    expect(env.URL).toBe("http://$MISSING/path");
  });

  it("should match env keys case-sensitively", async () => {
    const schema = t.object({
      HOST: t.optional(t.text()),
      URL: t.optional(t.text()),
    });

    const alepha = Alepha.create({
      env: { HOST: "localhost", URL: "$host" },
    });

    const env = alepha.parseEnv(schema);
    expect(env.URL).toBe("$host");
  });

  it("should resolve transitive $KEY references", async () => {
    const schema = t.object({
      A: t.optional(t.text()),
      B: t.optional(t.text()),
      C: t.optional(t.text()),
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
    const schema = t.object({
      PORT: t.optional(t.text()),
      PORT_NAME: t.optional(t.text()),
      URL: t.optional(t.text()),
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
    const schema = t.object({
      A: t.optional(t.text()),
      AB: t.optional(t.text()),
      ABC: t.optional(t.text()),
      RESULT: t.optional(t.text()),
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
    const schema = t.object({
      FOO: t.optional(t.text()),
    });

    const alepha = Alepha.create({
      env: { FOO: "bar" },
    });

    const first = alepha.parseEnv(schema);
    const second = alepha.parseEnv(schema);
    expect(first).toBe(second);
  });
});
