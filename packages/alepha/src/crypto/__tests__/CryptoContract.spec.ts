import { AlephaError } from "alepha";
import type { CryptoProvider as ExportedCryptoProvider } from "alepha/crypto";
import { describe, expectTypeOf, it } from "vitest";

import type { CryptoProvider as BrowserExport } from "../index.browser.ts";
import { BrowserCryptoProvider } from "../providers/BrowserCryptoProvider.ts";
import { CryptoProvider } from "../providers/CryptoProvider.ts";
import type {
  CryptoAlgorithm,
  CryptoProviderBase,
} from "../providers/CryptoProviderBase.ts";

describe("the portable crypto contract", () => {
  it("matches the exported type on Node and browser", ({ expect }) => {
    expectTypeOf<
      Pick<ExportedCryptoProvider, keyof CryptoProviderBase>
    >().toEqualTypeOf<Pick<BrowserExport, keyof CryptoProviderBase>>();
    expectTypeOf<Parameters<ExportedCryptoProvider["hash"]>[1]>().toEqualTypeOf<
      CryptoAlgorithm | undefined
    >();
    expect(true).toBe(true);
  });

  for (const algorithm of ["sha256", "sha384", "sha512"] as const) {
    it(`produces identical hashes and HMACs with ${algorithm}`, async ({
      expect,
    }) => {
      const node = new CryptoProvider();
      const browser = new BrowserCryptoProvider();
      const hash = node.hash("payload", algorithm);
      expect(hash).toBeInstanceOf(Promise);
      expect(await hash).toBe(await browser.hash("payload", algorithm));
      const signature = await node.hmac("payload", "secret", algorithm);
      expect(signature).toBe(
        await browser.hmac("payload", "secret", algorithm),
      );
      expect(
        await browser.verifyHmac("payload", signature, "secret", algorithm),
      ).toBe(true);
    });
  }

  it("reads each runtime's ciphertext on the other runtime", async ({
    expect,
  }) => {
    const node = new CryptoProvider();
    const browser = new BrowserCryptoProvider();
    expect(
      await browser.decrypt(await node.encrypt("payload", "key"), "key"),
    ).toBe("payload");
    expect(
      await node.decrypt(await browser.encrypt("payload", "key"), "key"),
    ).toBe("payload");
  });

  it("refuses algorithms outside the portable vocabulary on both runtimes", async ({
    expect,
  }) => {
    for (const provider of [
      new CryptoProvider(),
      new BrowserCryptoProvider(),
    ]) {
      await expect(provider.hash("payload", "md5" as never)).rejects.toThrow(
        AlephaError,
      );
      await expect(
        provider.hmac("payload", "secret", "md5" as never),
      ).rejects.toThrow(AlephaError);
    }
  });
});
