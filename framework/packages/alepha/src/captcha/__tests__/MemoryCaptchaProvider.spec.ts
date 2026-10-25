import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { CaptchaProvider, MemoryCaptchaProvider } from "../index.ts";

describe("MemoryCaptchaProvider", () => {
  it("should be registered as default CaptchaProvider", async ({ expect }) => {
    const alepha = Alepha.create();
    const provider = alepha.inject(CaptchaProvider);
    await alepha.start();

    expect(provider).toBeInstanceOf(MemoryCaptchaProvider);
  });

  it("should accept all tokens by default", async ({ expect }) => {
    const alepha = Alepha.create();
    const provider = alepha.inject(MemoryCaptchaProvider);
    await alepha.start();

    const result = await provider.verify("test-token", "127.0.0.1");

    expect(result).toBe(true);
    expect(provider.records).toHaveLength(1);
    expect(provider.records[0].token).toBe("test-token");
    expect(provider.records[0].ip).toBe("127.0.0.1");
  });

  it("should reject tokens when configured", async ({ expect }) => {
    const alepha = Alepha.create();
    const provider = alepha.inject(MemoryCaptchaProvider);
    await alepha.start();

    provider.reject();
    const result = await provider.verify("test-token");

    expect(result).toBe(false);
    expect(provider.records).toHaveLength(1);
  });

  it("should restore acceptance after reject", async ({ expect }) => {
    const alepha = Alepha.create();
    const provider = alepha.inject(MemoryCaptchaProvider);
    await alepha.start();

    provider.reject();
    provider.accept();

    const result = await provider.verify("test-token");
    expect(result).toBe(true);
  });

  it("should track verification with wasVerified helper", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const provider = alepha.inject(MemoryCaptchaProvider);
    await alepha.start();

    await provider.verify("abc-123");

    expect(provider.wasVerified("abc-123")).toBe(true);
    expect(provider.wasVerified("unknown")).toBe(false);
  });

  it("should return last record", async ({ expect }) => {
    const alepha = Alepha.create();
    const provider = alepha.inject(MemoryCaptchaProvider);
    await alepha.start();

    await provider.verify("first");
    await provider.verify("second");

    expect(provider.last?.token).toBe("second");
  });
});
