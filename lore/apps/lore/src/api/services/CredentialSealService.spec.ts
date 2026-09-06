import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { CredentialSealService } from "./CredentialSealService.ts";

const APP_SECRET = "a-strong-unique-secret-for-this-spec";

const OTHER_PURPOSE = "lore:app-secrets:v1";

const sealer = async (env: Record<string, string> = {}) => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", APP_SECRET, ...env },
  });
  const service = alepha.inject(CredentialSealService);
  await alepha.start();
  return service;
};

describe("CredentialSealService", () => {
  it("should open what it sealed", async ({ expect }) => {
    const service = await sealer();
    const token = "cfut_abcdefghijklmnopqrstuvwxyz0123456789ABCD";

    const sealed = service.seal(token, CredentialSealService.ESTATE_PURPOSE);

    // The point of the column: what lands in the database is not the token.
    expect(sealed).not.toContain(token);
    expect(sealed.split(":")).toHaveLength(3);
    expect(service.open(sealed, CredentialSealService.ESTATE_PURPOSE)).toBe(
      token,
    );
  });

  it("should not open a credential sealed under another purpose", async ({
    expect,
  }) => {
    const service = await sealer();

    const sealed = service.seal("cfut_secret", OTHER_PURPOSE);

    // What keeps an estate token and #1813's app secrets on separate keys:
    // a ciphertext moved between the two columns fails rather than
    // decrypting into the wrong context.
    expect(() =>
      service.open(sealed, CredentialSealService.ESTATE_PURPOSE),
    ).toThrow();
  });

  it("should refuse a tampered ciphertext", async ({ expect }) => {
    const service = await sealer();
    const sealed = service.seal(
      "cfut_secret",
      CredentialSealService.ESTATE_PURPOSE,
    );

    const [iv, tag, body] = sealed.split(":");
    const flipped = `${body!.slice(0, -1)}${body!.endsWith("a") ? "b" : "a"}`;

    expect(() =>
      service.open(
        `${iv}:${tag}:${flipped}`,
        CredentialSealService.ESTATE_PURPOSE,
      ),
    ).toThrow();
  });

  it("should refuse to seal under the built-in default secret", async ({
    expect,
  }) => {
    // Boots with no APP_SECRET at all, which outside production is a warning
    // rather than a refusal. This service refuses anyway, in every
    // environment: a staging or self-hosted Lore would otherwise seal real
    // cloud tokens under a constant published in this repository and look
    // healthy doing it.
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    const service = alepha.inject(CredentialSealService);
    await alepha.start();

    expect(() =>
      service.seal("cfut_secret", CredentialSealService.ESTATE_PURPOSE),
    ).toThrow(/APP_SECRET/);
    expect(() =>
      service.open("iv:tag:body", CredentialSealService.ESTATE_PURPOSE),
    ).toThrow(/APP_SECRET/);
  });

  it("should refuse to seal nothing", async ({ expect }) => {
    const service = await sealer();

    // An empty credential would round-trip perfectly and mean nothing; the
    // caller has a bug, and a sealed empty string hides it until a deploy.
    expect(() =>
      service.seal("", CredentialSealService.ESTATE_PURPOSE),
    ).toThrow();
  });
});
