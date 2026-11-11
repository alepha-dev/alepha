import { $inject } from "alepha";

import { WebAuthnError } from "../errors/WebAuthnError.ts";
import { CborDecoder, type CborValue } from "./CborDecoder.ts";

/**
 * The flags byte of the authenticator data, bit by bit.
 */
export interface AuthenticatorDataFlags {
  /**
   * UP: a person was present (touched, tapped, approved).
   */
  userPresent: boolean;
  /**
   * UV: the person was verified (biometrics or PIN), not only present.
   */
  userVerified: boolean;
  /**
   * BE: the credential may be synced to other devices (a passkey).
   */
  backupEligible: boolean;
  /**
   * BS: the credential is synced right now.
   */
  backedUp: boolean;
  /**
   * AT: attested credential data follows (registration).
   */
  attestedCredentialData: boolean;
  /**
   * ED: extension data follows.
   */
  extensionData: boolean;
}

/**
 * The authenticator data of a registration or an assertion (WebAuthn
 * section 6.1), parsed.
 */
export interface AuthenticatorData {
  rpIdHash: Uint8Array;
  flags: AuthenticatorDataFlags;
  signCount: number;
  /**
   * Present when `flags.attestedCredentialData` is set.
   */
  attestedCredential?: {
    /**
     * The AAGUID as a lowercase UUID string.
     */
    aaguid: string;
    credentialId: Uint8Array;
    /**
     * The COSE_Key, decoded.
     */
    publicKey: CborValue;
  };
  extensions?: CborValue;
}

/**
 * Parses authenticator data: RP ID hash (32 bytes), flags (1), sign counter
 * (4, big-endian), then the attested credential data when AT is set (AAGUID
 * 16, credential id length 2, credential id, COSE public key) and the
 * extensions when ED is set. Bytes left over, or a flag announcing data that
 * is not there, are refused with reason `authenticatorData`.
 */
export class AuthenticatorDataParser {
  protected readonly cbor = $inject(CborDecoder);

  /**
   * The longest credential id WebAuthn allows (section 5.1).
   */
  public maxCredentialIdLength = 1023;

  public parse(bytes: Uint8Array): AuthenticatorData {
    const fail = () => new WebAuthnError({ reason: "authenticatorData" });
    if (bytes.length < 37) {
      throw fail();
    }
    const flagsByte = bytes[32]!;
    const flags: AuthenticatorDataFlags = {
      userPresent: (flagsByte & 0x01) !== 0,
      userVerified: (flagsByte & 0x04) !== 0,
      backupEligible: (flagsByte & 0x08) !== 0,
      backedUp: (flagsByte & 0x10) !== 0,
      attestedCredentialData: (flagsByte & 0x40) !== 0,
      extensionData: (flagsByte & 0x80) !== 0,
    };
    if (flags.backedUp && !flags.backupEligible) {
      throw fail();
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const result: AuthenticatorData = {
      rpIdHash: bytes.slice(0, 32),
      flags,
      signCount: view.getUint32(33),
    };
    let offset = 37;
    if (flags.attestedCredentialData) {
      if (bytes.length < offset + 18) {
        throw fail();
      }
      const aaguid = bytes.subarray(offset, offset + 16);
      offset += 16;
      const idLength = view.getUint16(offset);
      offset += 2;
      if (
        idLength === 0 ||
        idLength > this.maxCredentialIdLength ||
        bytes.length < offset + idLength
      ) {
        throw fail();
      }
      const credentialId = bytes.slice(offset, offset + idLength);
      offset += idLength;
      const key = this.cbor.decodeFirst(bytes, offset);
      offset = key.end;
      result.attestedCredential = {
        aaguid: this.uuid(aaguid),
        credentialId,
        publicKey: key.value,
      };
    }
    if (flags.extensionData) {
      const extensions = this.cbor.decodeFirst(bytes, offset);
      offset = extensions.end;
      result.extensions = extensions.value;
    }
    if (offset !== bytes.length) {
      throw fail();
    }
    return result;
  }

  protected uuid(bytes: Uint8Array): string {
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}
