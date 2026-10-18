import { Alepha, AlephaError } from "alepha";
import { AlephaEmailCloudflare } from "alepha/email/cloudflare";
import { describe, it } from "vitest";

import { CloudflareEmailDetector } from "../CloudflareEmailDetector.ts";

describe("CloudflareEmailDetector", () => {
  const detector = new CloudflareEmailDetector();

  /**
   * The regression (Club #Q675): string lookups moved from class names to
   * stable ids and the provider had none, so detection returned false for an
   * app that registers it and the build dropped `send_email`.
   */
  it("detects an app that registers alepha.email.cloudflare", ({ expect }) => {
    const alepha = Alepha.create().with(AlephaEmailCloudflare);
    expect(detector.detect(alepha)).toBe(true);
  });

  it("answers false for an app without it", ({ expect }) => {
    expect(detector.detect(Alepha.create())).toBe(false);
  });

  it("fails loudly when the module is registered but the id lookup misses", ({
    expect,
  }) => {
    const alepha = {
      inject: (id: string) => {
        throw new AlephaError(`Service not found: ${id}`);
      },
      graph: () => ({
        CloudflareEmailProvider: {
          from: [],
          module: "alepha.email.cloudflare",
        },
      }),
    } as unknown as Alepha;
    expect(() => detector.detect(alepha)).toThrow(/send_email/);
  });

  it("rethrows an error that is not a missing service", ({ expect }) => {
    const alepha = {
      inject: () => {
        throw new Error("boom");
      },
      graph: () => ({}),
    } as unknown as Alepha;
    expect(() => detector.detect(alepha)).toThrow("boom");
  });
});
