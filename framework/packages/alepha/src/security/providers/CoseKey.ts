import { $inject } from "alepha";

import {
  UnsupportedCoseAlgorithmError,
  WebAuthnError,
} from "../errors/WebAuthnError.ts";
import { Base64Url } from "./Base64Url.ts";
import type { CborValue } from "./CborDecoder.ts";

/**
 * A credential public key as a JWK, with the WebAuthn algorithm it signs
 * with in `alg`. This is what a passkey stores: a public key, nothing secret.
 */
export interface WebAuthnPublicKeyJwk {
  kty: "EC" | "RSA" | "OKP";
  alg: "ES256" | "RS256" | "EdDSA";
  crv?: "P-256" | "Ed25519";
  x?: string;
  y?: string;
  n?: string;
  e?: string;
}

/**
 * COSE public keys (RFC 9052, 9053) to JWK, and signature checks with that
 * JWK on `crypto.subtle`.
 *
 * Accepted: EC2 on P-256 with ES256 (-7), RSA with RS256 (-257), and OKP on
 * Ed25519 with EdDSA (-8). Any other algorithm, key type or curve is an
 * {@link UnsupportedCoseAlgorithmError}, as is EdDSA on a runtime whose
 * WebCrypto has no Ed25519.
 */
export class CoseKey {
  protected readonly base64url = $inject(Base64Url);

  /**
   * The COSE algorithm identifiers accepted, in the order a relying party
   * offers them in `pubKeyCredParams`.
   */
  public readonly algorithms = [-7, -257, -8] as const;

  /**
   * A decoded COSE_Key map to a JWK.
   */
  public toJwk(cose: CborValue): WebAuthnPublicKeyJwk {
    if (!(cose instanceof Map)) {
      throw new WebAuthnError({ reason: "credential" });
    }
    const kty = cose.get(1);
    const alg = cose.get(3);
    if (kty === 2 && alg === -7) {
      const crv = cose.get(-1);
      const x = cose.get(-2);
      const y = cose.get(-3);
      if (crv !== 1) {
        throw new UnsupportedCoseAlgorithmError({ reason: "algorithm" });
      }
      if (!this.isBytes(x, 32) || !this.isBytes(y, 32)) {
        throw new WebAuthnError({ reason: "credential" });
      }
      return {
        kty: "EC",
        alg: "ES256",
        crv: "P-256",
        x: this.base64url.encode(x),
        y: this.base64url.encode(y),
      };
    }
    if (kty === 3 && alg === -257) {
      const n = cose.get(-1);
      const e = cose.get(-2);
      if (!this.isBytes(n) || !this.isBytes(e) || n.length < 256) {
        throw new WebAuthnError({ reason: "credential" });
      }
      return {
        kty: "RSA",
        alg: "RS256",
        n: this.base64url.encode(n),
        e: this.base64url.encode(e),
      };
    }
    if (kty === 1 && alg === -8) {
      const crv = cose.get(-1);
      const x = cose.get(-2);
      if (crv !== 6) {
        throw new UnsupportedCoseAlgorithmError({ reason: "algorithm" });
      }
      if (!this.isBytes(x, 32)) {
        throw new WebAuthnError({ reason: "credential" });
      }
      return {
        kty: "OKP",
        alg: "EdDSA",
        crv: "Ed25519",
        x: this.base64url.encode(x),
      };
    }
    throw new UnsupportedCoseAlgorithmError({ reason: "algorithm" });
  }

  /**
   * The COSE algorithm identifier of a JWK this class produced.
   */
  public algorithmOf(jwk: WebAuthnPublicKeyJwk): number {
    switch (jwk.alg) {
      case "ES256":
        return -7;
      case "RS256":
        return -257;
      case "EdDSA":
        return -8;
      default:
        throw new UnsupportedCoseAlgorithmError({ reason: "algorithm" });
    }
  }

  /**
   * Import the JWK as a WebCrypto verification key. Refuses a key the
   * runtime cannot import as {@link UnsupportedCoseAlgorithmError} for
   * EdDSA (no Ed25519 in that WebCrypto), {@link WebAuthnError} of reason
   * `credential` otherwise (a point off the curve, say).
   */
  public async importKey(jwk: WebAuthnPublicKeyJwk): Promise<CryptoKey> {
    const { alg: _alg, ...material } = jwk;
    const algorithm = this.importAlgorithm(jwk);
    try {
      return await crypto.subtle.importKey(
        "jwk",
        { ...material, ext: true } as JsonWebKey,
        algorithm,
        true,
        ["verify"],
      );
    } catch (error) {
      if (jwk.alg === "EdDSA" && this.isNotSupported(error)) {
        throw new UnsupportedCoseAlgorithmError(
          { reason: "algorithm" },
          { message: "This runtime's WebCrypto has no Ed25519", cause: error },
        );
      }
      throw new WebAuthnError({ reason: "credential" }, { cause: error });
    }
  }

  /**
   * Check `signature` over `data` with the JWK. An ES256 signature arrives
   * DER-encoded, as WebAuthn sends it, and is converted to the raw `r || s`
   * WebCrypto expects; a malformed DER is refused with reason `signature`.
   */
  public async verify(
    jwk: WebAuthnPublicKeyJwk,
    signature: Uint8Array,
    data: Uint8Array,
  ): Promise<boolean> {
    const key = await this.importKey(jwk);
    const raw = jwk.alg === "ES256" ? this.derToRaw(signature, 32) : signature;
    return crypto.subtle.verify(
      this.verifyAlgorithm(jwk),
      key,
      raw as Uint8Array<ArrayBuffer>,
      data as Uint8Array<ArrayBuffer>,
    );
  }

  /**
   * An ASN.1 DER `ECDSA-Sig-Value` (`SEQUENCE { r INTEGER, s INTEGER }`) to
   * the fixed-width `r || s` of IEEE P1363, each integer `size` bytes.
   * Strict: minimal lengths and integers, no trailing bytes.
   */
  public derToRaw(der: Uint8Array, size: number): Uint8Array {
    const fail = () => new WebAuthnError({ reason: "signature" });
    if (der.length < 8 || der[0] !== 0x30) {
      throw fail();
    }
    let offset = 1;
    const sequenceLength = der[offset++];
    if (sequenceLength === undefined || sequenceLength & 0x80) {
      throw fail();
    }
    if (offset + sequenceLength !== der.length) {
      throw fail();
    }
    const out = new Uint8Array(size * 2);
    for (let part = 0; part < 2; part++) {
      if (der[offset++] !== 0x02) {
        throw fail();
      }
      const length = der[offset++];
      if (length === undefined || length === 0 || length > size + 1) {
        throw fail();
      }
      if (offset + length > der.length) {
        throw fail();
      }
      let integer = der.subarray(offset, offset + length);
      offset += length;
      if (integer[0]! & 0x80) {
        throw fail();
      }
      if (integer[0] === 0 && integer.length > 1) {
        if (!(integer[1]! & 0x80)) {
          throw fail();
        }
        integer = integer.subarray(1);
      }
      if (integer.length > size) {
        throw fail();
      }
      out.set(integer, part * size + (size - integer.length));
    }
    if (offset !== der.length) {
      throw fail();
    }
    return out;
  }

  protected importAlgorithm(
    jwk: WebAuthnPublicKeyJwk,
  ): EcKeyImportParams | RsaHashedImportParams | Algorithm {
    switch (jwk.alg) {
      case "ES256":
        return { name: "ECDSA", namedCurve: "P-256" };
      case "RS256":
        return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
      case "EdDSA":
        return { name: "Ed25519" };
      default:
        throw new UnsupportedCoseAlgorithmError({ reason: "algorithm" });
    }
  }

  protected verifyAlgorithm(
    jwk: WebAuthnPublicKeyJwk,
  ): EcdsaParams | Algorithm {
    switch (jwk.alg) {
      case "ES256":
        return { name: "ECDSA", hash: "SHA-256" };
      case "RS256":
        return { name: "RSASSA-PKCS1-v1_5" };
      default:
        return { name: "Ed25519" };
    }
  }

  protected isBytes(value: unknown, length?: number): value is Uint8Array {
    return (
      value instanceof Uint8Array &&
      (length === undefined || value.length === length)
    );
  }

  protected isNotSupported(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name === "NotSupportedError" ||
        /not supported|unrecognized|unknown algorithm/i.test(error.message))
    );
  }
}
