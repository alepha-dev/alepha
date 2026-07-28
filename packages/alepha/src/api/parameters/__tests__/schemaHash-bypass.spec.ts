import { Alepha, z } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { describe, expect, it } from "vitest";
import { AlephaApiParameters } from "../index.ts";
import { $parameter } from "../primitives/$parameter.ts";
import { createParameterVersionBodySchema } from "../schemas/createParameterVersionBodySchema.ts";
import { ParameterProvider } from "../services/ParameterProvider.ts";

/**
 * `save()` validates content only when the supplied schema hash equals the
 * registered one — a deliberate escape hatch for migration seeds. The admin
 * create-version body accepted `schemaHash` from the client, so anyone with
 * `admin:parameter:write` could send a junk hash and store arbitrary JSON that
 * every typed `$parameter.get()` consumer then reads as `Static<T>`.
 */
class FeatureFlags {
  public readonly flags = $parameter({
    name: "app.flags",
    schema: z.object({
      maxUploads: z.integer(),
      label: z.text(),
    }),
    default: { maxUploads: 10, label: "hello" },
  });
}

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaOrmPostgres)
    .with(AlephaSecurity)
    .with(AlephaApiParameters)
    .with(FeatureFlags);
  const parameters = alepha.inject(ParameterProvider);
  await alepha.start();
  return { alepha, parameters };
};

describe("parameter schemaHash validation bypass", () => {
  it("does not let the admin body carry a schemaHash", () => {
    // The hash is a server-side migration concern. Accepting it from the
    // client is what made the bypass reachable over HTTP.
    expect(Object.keys(createParameterVersionBodySchema.shape)).not.toContain(
      "schemaHash",
    );
  });

  it("rejects content that violates the registered schema", async () => {
    const { alepha, parameters } = await setup();

    await expect(
      parameters.save("app.flags", { maxUploads: "not-a-number" } as never, ""),
    ).rejects.toThrow();

    await alepha.stop();
  });

  it("accepts valid content", async () => {
    const { alepha, parameters } = await setup();

    const saved = await parameters.save(
      "app.flags",
      { maxUploads: 42, label: "hi" } as never,
      "",
    );
    expect(saved.content).toMatchObject({ maxUploads: 42, label: "hi" });

    await alepha.stop();
  });

  it("still allows an explicit migration hash to skip validation", async () => {
    const { alepha, parameters } = await setup();

    // The seed path stays open — it is how content written under an older
    // schema is restored without being judged by the current one.
    const saved = await parameters.save(
      "app.flags",
      { legacyShape: true } as never,
      "hash-from-a-previous-schema",
    );
    expect(saved.content).toMatchObject({ legacyShape: true });

    await alepha.stop();
  });
});
