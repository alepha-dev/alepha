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
});
