import { WebAuthnError } from "../errors/WebAuthnError.ts";

/**
 * Base64url (RFC 4648 section 5, no padding) to bytes and back, with `atob`
 * and `btoa` only: the same code on Node, Bun, workerd and the browser, with
 * no `Buffer`.
 *
 * Decoding is strict: a character outside the url-safe alphabet, padding,
 * or a length no encoding produces is refused with a {@link WebAuthnError}
 * of reason `encoding`.
 */
export class Base64Url {
  /**
   * Bytes to base64url, without padding.
   */
  public encode(bytes: Uint8Array | ArrayBuffer): string {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = "";
    for (let i = 0; i < view.length; i += 0x8000) {
      binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
    }
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  /**
   * Base64url to bytes.
   */
  public decode(text: string): Uint8Array {
    if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) {
      throw new WebAuthnError({ reason: "encoding" });
    }
    const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }
}
