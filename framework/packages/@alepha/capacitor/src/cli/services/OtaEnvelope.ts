import {
  constants,
  createCipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  privateEncrypt,
  randomBytes,
} from "node:crypto";

import { AlephaError } from "alepha";

/**
 * Capgo v2 bundle encryption, byte for byte what the pinned `@capgo/cli`
 * 8.75.2 writes for `@capgo/capacitor-updater` 8.52.1, on the publisher's
 * machine only.
 *
 * - a fresh 16-byte AES key and IV per bundle; the ZIP is encrypted with
 *   AES-128-CBC (PKCS#7 padding);
 * - the session key is `<iv>:<key>`, both base64, the key encrypted with the
 *   publisher's RSA private key (PKCS#1 v1.5, the `privateEncrypt` the plugin
 *   undoes with `publicKey`);
 * - the checksum is the plain ZIP's SHA-256, encrypted with the same private
 *   key, hex (the format the CLI picks for an updater from 5.30, 6.30 and
 *   7.30 on, so every 8.x).
 *
 * The private key never leaves this process: it is read from the
 * publisher's environment, never from an argument, and nothing here logs it.
 * The device holds the public key (`publicKey` in its native config), and so
 * may the server, which can therefore open and inspect a bundle but never
 * make one.
 *
 * Kept in-house rather than calling `@capgo/cli`'s SDK, whose `encryptBundle`
 * reads and may rewrite the project's `capacitor.config.ts` from the working
 * directory; the conformance spec proves both directions against that SDK.
 */
export class OtaEnvelope {
  /**
   * Encrypt a ZIP for the device.
   */
  public seal(zip: Uint8Array, privateKey: string): OtaSealedBundle {
    const key = this.privateKey(privateKey);
    const sessionKey = randomBytes(16);
    const iv = randomBytes(16);
    const encryptedKey = privateEncrypt(
      { key, padding: constants.RSA_PKCS1_PADDING },
      sessionKey,
    );
    const cipher = createCipheriv("aes-128-cbc", sessionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(zip), cipher.final()]);
    const archiveSha256 = this.sha256(zip);
    const checksum = privateEncrypt(
      { key, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(archiveSha256, "hex"),
    ).toString("hex");

    return {
      ciphertext: new Uint8Array(ciphertext),
      sessionKey: `${iv.toString("base64")}:${encryptedKey.toString("base64")}`,
      checksum,
      archiveSha256,
      ciphertextSha256: this.sha256(ciphertext),
    };
  }

  /**
   * A new publisher key pair: RSA 2048, both halves PKCS#1 PEM, as
   * `npx @capgo/cli key create` makes them.
   */
  public generateKeyPair(): { publicKey: string; privateKey: string } {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    return {
      publicKey: publicKey.export({ type: "pkcs1", format: "pem" }).toString(),
      privateKey: privateKey
        .export({ type: "pkcs1", format: "pem" })
        .toString(),
    };
  }

  /**
   * The PKCS#1 PEM public half of a private key: what goes in the native
   * config and on the server.
   */
  public publicKeyOf(privateKey: string): string {
    return createPublicKey(this.privateKey(privateKey))
      .export({ type: "pkcs1", format: "pem" })
      .toString();
  }

  /**
   * The plugin's key identity: the first 20 characters of the PKCS#1 public
   * key's base64 body.
   */
  public keyId(publicKey: string): string {
    return publicKey
      .replace(/-----(BEGIN|END) RSA PUBLIC KEY-----/g, "")
      .replace(/\s/g, "")
      .slice(0, 20);
  }

  public sha256(data: Uint8Array): string {
    return createHash("sha256").update(data).digest("hex");
  }

  protected privateKey(pem: string) {
    if (!pem.includes("-----BEGIN RSA PRIVATE KEY-----")) {
      throw new AlephaError(
        "The OTA signing key is not an RSA private key in PKCS#1 PEM (-----BEGIN RSA PRIVATE KEY-----).",
      );
    }
    try {
      return createPrivateKey(pem);
    } catch {
      throw new AlephaError("The OTA signing key could not be read.");
    }
  }
}

/**
 * One bundle, encrypted for the device.
 */
export interface OtaSealedBundle {
  ciphertext: Uint8Array;

  /**
   * `<iv>:<encrypted AES key>`, both base64.
   */
  sessionKey: string;

  /**
   * The plugin checksum: the plain ZIP's SHA-256, encrypted, hex.
   */
  checksum: string;

  /**
   * The plain ZIP's SHA-256, hex.
   */
  archiveSha256: string;

  /**
   * The encrypted file's SHA-256, hex.
   */
  ciphertextSha256: string;
}
