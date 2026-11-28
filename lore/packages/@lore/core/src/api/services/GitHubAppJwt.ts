import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import { GitHubKeyFormat } from "./GitHubKeyFormat.ts";

/**
 * Signs the App's JWT (#Q4363): RS256 with the App's private key, through
 * WebCrypto, so it runs on workerd and Node alike, with no SDK and no
 * `node:crypto`.
 *
 * `iat` is backdated 60 s for clock skew and `exp` is nine minutes ahead,
 * under GitHub's ten. The key is PKCS#8 (`GitHubKeyFormat`): GitHub's PKCS#1
 * was converted when it was stored or read from the environment. The
 * imported key is kept per PEM for the process, never the PEM's bytes.
 */
export class GitHubAppJwt {
  /**
   * How far `iat` is backdated: GitHub refuses a JWT issued in its future.
   */
  public static readonly SKEW_SECONDS = 60;

  /**
   * How long a JWT lasts after `iat`'s real time; GitHub's cap is ten
   * minutes.
   */
  public static readonly TTL_SECONDS = 9 * 60;

  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly keys = $inject(GitHubKeyFormat);
  protected readonly imported = new Map<string, Promise<CryptoKey>>();

  async sign(appId: string, pkcs8Pem: string): Promise<string> {
    const now = Math.floor(this.dateTime.nowMillis() / 1000);
    const header = this.base64url(
      new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    );
    const payload = this.base64url(
      new TextEncoder().encode(
        JSON.stringify({
          iat: now - GitHubAppJwt.SKEW_SECONDS,
          exp: now + GitHubAppJwt.TTL_SECONDS,
          iss: appId,
        }),
      ),
    );
    const input = `${header}.${payload}`;
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      await this.key(pkcs8Pem),
      new TextEncoder().encode(input),
    );
    return `${input}.${this.base64url(new Uint8Array(signature))}`;
  }

  protected key(pem: string): Promise<CryptoKey> {
    let key = this.imported.get(pem);
    if (!key) {
      key = crypto.subtle.importKey(
        "pkcs8",
        this.keys.pkcs8Der(pem),
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"],
      );
      key.catch(() => this.imported.delete(pem));
      // A rotated key replaces the old one; the map never holds more than a
      // couple.
      if (this.imported.size > 4) this.imported.clear();
      this.imported.set(pem, key);
    }
    return key;
  }

  protected base64url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
}
