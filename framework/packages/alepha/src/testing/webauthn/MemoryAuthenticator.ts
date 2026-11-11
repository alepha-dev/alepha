import { $inject } from "alepha";
import {
  type AuthenticationOptionsJson,
  type AuthenticationResponseJson,
  Base64Url,
  type RegistrationOptionsJson,
  type RegistrationResponseJson,
} from "alepha/security";

import { CborEncoder, type CborInput } from "./CborEncoder.ts";

/**
 * The algorithms the software authenticator can create a credential with:
 * every one `WebAuthnVerifier` accepts.
 */
export type MemoryAuthenticatorAlgorithm = "ES256" | "RS256" | "EdDSA";

/**
 * A credential the authenticator holds.
 */
export interface MemoryCredential {
  /**
   * The credential id, base64url.
   */
  id: string;
  rpId: string;
  /**
   * The user handle the relying party set (`user.id`), base64url.
   */
  userHandle: string;
  algorithm: MemoryAuthenticatorAlgorithm;
  privateKey: CryptoKey;
  signCount: number;
  backupEligible: boolean;
}

/**
 * Knobs for one ceremony, to play a device that is not well behaved. Every
 * one defaults to the authenticator's own setting.
 */
export interface MemoryCeremonyOptions {
  /**
   * The page's origin, written into `clientDataJSON`.
   */
  origin?: string;
  /**
   * Set UV, as after a biometric or PIN check. Defaults to `true`.
   */
  userVerified?: boolean;
  /**
   * Set UP. Defaults to `true`: only a broken authenticator clears it.
   */
  userPresent?: boolean;
  /**
   * The sign counter to report, instead of the stored one plus one. Use it
   * to replay (the same value) or regress (a lower one). The credential
   * keeps the value given.
   */
  counter?: number;
  /**
   * `crossOrigin: true` in `clientDataJSON`, as from an iframe of another
   * site.
   */
  crossOrigin?: boolean;
  /**
   * Break one thing on purpose, after everything else is right:
   * `signature` flips a bit of the signature, `challenge` answers another
   * challenge, `rpId` hashes another RP id, `type` writes the other
   * ceremony's type, `attestation` breaks a packed self attestation.
   */
  tamper?: "signature" | "challenge" | "rpId" | "type" | "attestation";
}

/**
 * Knobs for a registration.
 */
export interface MemoryRegistrationOptions extends MemoryCeremonyOptions {
  /**
   * The key to create. Defaults to the authenticator's `algorithm`, when
   * the relying party offers it, else the first offered one it supports.
   */
  algorithm?: MemoryAuthenticatorAlgorithm;
  /**
   * The attestation format: `none` (the default), or a `packed` self
   * attestation, which some platforms send even when `none` is asked.
   */
  attestation?: "none" | "packed";
  /**
   * Set BE (and BS): a synced passkey. Defaults to `true`.
   */
  backupEligible?: boolean;
}

/**
 * Knobs for an assertion.
 */
export interface MemoryAssertionOptions extends MemoryCeremonyOptions {
  /**
   * Answer with this credential, the user's choice on a device holding
   * several. Without it: the first allowed credential held, or, when the
   * relying party allows any, the first held for the RP id.
   */
  credentialId?: string;
}

/**
 * An in-memory WebAuthn authenticator on `crypto.subtle`: the user's device,
 * for specs. It answers the options a server issues with real registration
 * and assertion responses (fresh key pairs, COSE keys, authenticator data,
 * signatures), so a spec drives the true verification path with no mock.
 *
 * It holds several credentials, across relying parties, and refuses as a
 * browser would: `InvalidStateError` when an excluded credential is held,
 * `NotAllowedError` when no credential matches. Runs on Node, Bun, workerd
 * and jsdom.
 *
 * @example
 * ```ts
 * import { MemoryAuthenticator } from "alepha/testing/webauthn";
 *
 * const device = alepha.inject(MemoryAuthenticator);
 * device.origin = "http://localhost:3000";
 *
 * const options = await client.registrationOptions();
 * const credential = await device.create(options);
 * await client.register({ credential });
 *
 * const assertion = await device.get(await client.signInOptions());
 * const replay = await device.get(options2, { counter: 1 }); // a clone
 * ```
 */
export class MemoryAuthenticator {
  protected readonly base64url = $inject(Base64Url);
  protected readonly cbor = $inject(CborEncoder);

  /**
   * The page's origin, for every ceremony that names none.
   */
  public origin = "http://localhost";

  /**
   * The key a registration creates when the relying party offers it.
   */
  public algorithm: MemoryAuthenticatorAlgorithm = "ES256";

  /**
   * The AAGUID it reports: zeros, as a platform authenticator under
   * `attestation: "none"` does.
   */
  public aaguid = new Uint8Array(16);

  protected readonly held: MemoryCredential[] = [];

  /**
   * Every credential held, oldest first.
   */
  public credentials(): MemoryCredential[] {
    return [...this.held];
  }

  /**
   * One credential by id.
   */
  public credential(id: string): MemoryCredential | undefined {
    return this.held.find((it) => it.id === id);
  }

  /**
   * Forget a credential, as when a passkey is deleted from the device.
   */
  public remove(id: string): void {
    const index = this.held.findIndex((it) => it.id === id);
    if (index >= 0) {
      this.held.splice(index, 1);
    }
  }

  /**
   * Answer `navigator.credentials.create()`.
   */
  public async create(
    options: RegistrationOptionsJson,
    knobs: MemoryRegistrationOptions = {},
  ): Promise<RegistrationResponseJson> {
    const origin = knobs.origin ?? this.origin;
    const rpId = options.rp.id ?? new URL(origin).hostname;
    if (
      options.excludeCredentials?.some((it) =>
        this.held.some((held) => held.id === it.id && held.rpId === rpId),
      )
    ) {
      throw new DOMException(
        "The authenticator already holds one of the excluded credentials",
        "InvalidStateError",
      );
    }
    const algorithm = this.pickAlgorithm(options, knobs.algorithm);
    const { privateKey, publicKey } = await this.generate(algorithm);
    const id = this.base64url.encode(
      crypto.getRandomValues(new Uint8Array(32)),
    );
    const backupEligible = knobs.backupEligible ?? true;
    const credential: MemoryCredential = {
      id,
      rpId,
      userHandle: options.user.id,
      algorithm,
      privateKey,
      signCount: knobs.counter ?? 0,
      backupEligible,
    };

    const clientData = this.clientData("webauthn.create", options.challenge, {
      ...knobs,
      origin,
    });
    const idBytes = this.base64url.decode(id);
    const cose = this.cbor.encode(await this.coseKey(algorithm, publicKey));
    const attested = this.concat(
      this.aaguid,
      new Uint8Array([idBytes.length >> 8, idBytes.length & 0xff]),
      idBytes,
      cose,
    );
    const authData = await this.authData(
      knobs.tamper === "rpId" ? `not-${rpId}` : rpId,
      knobs,
      credential.signCount,
      backupEligible,
      attested,
    );

    const statement = new Map<number | string, CborInput>();
    let format = "none";
    if (knobs.attestation === "packed") {
      format = "packed";
      let sig = await this.sign(
        credential,
        this.concat(authData, await this.sha256(clientData)),
      );
      if (knobs.tamper === "attestation") {
        sig = this.flip(sig);
      }
      statement.set("alg", this.coseAlgorithm(algorithm));
      statement.set("sig", sig);
    }
    const attestationObject = this.cbor.encode(
      new Map<number | string, CborInput>([
        ["fmt", format],
        ["attStmt", statement],
        ["authData", authData],
      ]),
    );

    this.held.push(credential);
    return {
      id,
      rawId: id,
      type: "public-key",
      response: {
        clientDataJSON: this.base64url.encode(clientData),
        attestationObject: this.base64url.encode(attestationObject),
        transports: ["internal", "hybrid"],
      },
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
    };
  }

  /**
   * Answer `navigator.credentials.get()`.
   */
  public async get(
    options: AuthenticationOptionsJson,
    knobs: MemoryAssertionOptions = {},
  ): Promise<AuthenticationResponseJson> {
    const origin = knobs.origin ?? this.origin;
    const rpId = options.rpId ?? new URL(origin).hostname;
    const allowed = options.allowCredentials ?? [];
    const candidates = this.held.filter(
      (it) =>
        it.rpId === rpId &&
        (allowed.length === 0 || allowed.some((a) => a.id === it.id)),
    );
    const credential = knobs.credentialId
      ? candidates.find((it) => it.id === knobs.credentialId)
      : candidates[0];
    if (!credential) {
      throw new DOMException(
        "No credential is available for this relying party",
        "NotAllowedError",
      );
    }
    credential.signCount = knobs.counter ?? credential.signCount + 1;

    const clientData = this.clientData("webauthn.get", options.challenge, {
      ...knobs,
      origin,
    });
    const authData = await this.authData(
      knobs.tamper === "rpId" ? `not-${rpId}` : rpId,
      knobs,
      credential.signCount,
      credential.backupEligible,
    );
    let signature = await this.sign(
      credential,
      this.concat(authData, await this.sha256(clientData)),
    );
    if (knobs.tamper === "signature") {
      signature = this.flip(signature);
    }
    return {
      id: credential.id,
      rawId: credential.id,
      type: "public-key",
      response: {
        clientDataJSON: this.base64url.encode(clientData),
        authenticatorData: this.base64url.encode(authData),
        signature: this.base64url.encode(signature),
        userHandle: credential.userHandle,
      },
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
    };
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected pickAlgorithm(
    options: RegistrationOptionsJson,
    wanted?: MemoryAuthenticatorAlgorithm,
  ): MemoryAuthenticatorAlgorithm {
    if (wanted) {
      return wanted;
    }
    const offered = options.pubKeyCredParams.map((it) => it.alg);
    if (offered.includes(this.coseAlgorithm(this.algorithm))) {
      return this.algorithm;
    }
    for (const alg of offered) {
      const name = this.algorithmName(alg);
      if (name) {
        return name;
      }
    }
    throw new DOMException(
      "None of the offered algorithms is supported",
      "NotSupportedError",
    );
  }

  protected clientData(
    type: "webauthn.create" | "webauthn.get",
    challenge: string,
    knobs: MemoryCeremonyOptions & { origin: string },
  ): Uint8Array {
    const other =
      type === "webauthn.create" ? "webauthn.get" : "webauthn.create";
    return new TextEncoder().encode(
      JSON.stringify({
        type: knobs.tamper === "type" ? other : type,
        challenge:
          knobs.tamper === "challenge" ? `${challenge}AAAA` : challenge,
        origin: knobs.origin,
        crossOrigin: knobs.crossOrigin ?? false,
      }),
    );
  }

  protected async authData(
    rpId: string,
    knobs: MemoryCeremonyOptions,
    signCount: number,
    backupEligible: boolean,
    attested?: Uint8Array,
  ): Promise<Uint8Array> {
    let flags = 0;
    if (knobs.userPresent ?? true) flags |= 0x01;
    if (knobs.userVerified ?? true) flags |= 0x04;
    if (backupEligible) flags |= 0x08 | 0x10;
    if (attested) flags |= 0x40;
    const counter = new Uint8Array(4);
    new DataView(counter.buffer).setUint32(0, signCount);
    return this.concat(
      await this.sha256(new TextEncoder().encode(rpId)),
      new Uint8Array([flags]),
      counter,
      attested ?? new Uint8Array(0),
    );
  }

  protected async generate(
    algorithm: MemoryAuthenticatorAlgorithm,
  ): Promise<CryptoKeyPair> {
    switch (algorithm) {
      case "ES256":
        return (await crypto.subtle.generateKey(
          { name: "ECDSA", namedCurve: "P-256" },
          true,
          ["sign", "verify"],
        )) as CryptoKeyPair;
      case "RS256":
        return (await crypto.subtle.generateKey(
          {
            name: "RSASSA-PKCS1-v1_5",
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256",
          },
          true,
          ["sign", "verify"],
        )) as CryptoKeyPair;
      default:
        return (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
          "sign",
          "verify",
        ])) as CryptoKeyPair;
    }
  }

  protected async coseKey(
    algorithm: MemoryAuthenticatorAlgorithm,
    publicKey: CryptoKey,
  ): Promise<Map<number, CborInput>> {
    const jwk = await crypto.subtle.exportKey("jwk", publicKey);
    const b = (value?: string) => this.base64url.decode(value ?? "");
    switch (algorithm) {
      case "ES256":
        return new Map<number, CborInput>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, b(jwk.x)],
          [-3, b(jwk.y)],
        ]);
      case "RS256":
        return new Map<number, CborInput>([
          [1, 3],
          [3, -257],
          [-1, b(jwk.n)],
          [-2, b(jwk.e)],
        ]);
      default:
        return new Map<number, CborInput>([
          [1, 1],
          [3, -8],
          [-1, 6],
          [-2, b(jwk.x)],
        ]);
    }
  }

  protected async sign(
    credential: MemoryCredential,
    data: Uint8Array,
  ): Promise<Uint8Array> {
    const bytes = data as Uint8Array<ArrayBuffer>;
    switch (credential.algorithm) {
      case "ES256":
        return this.rawToDer(
          new Uint8Array(
            await crypto.subtle.sign(
              { name: "ECDSA", hash: "SHA-256" },
              credential.privateKey,
              bytes,
            ),
          ),
        );
      case "RS256":
        return new Uint8Array(
          await crypto.subtle.sign(
            { name: "RSASSA-PKCS1-v1_5" },
            credential.privateKey,
            bytes,
          ),
        );
      default:
        return new Uint8Array(
          await crypto.subtle.sign(
            { name: "Ed25519" },
            credential.privateKey,
            bytes,
          ),
        );
    }
  }

  /**
   * IEEE P1363 `r || s` to the ASN.1 DER `ECDSA-Sig-Value` WebAuthn sends.
   */
  public rawToDer(raw: Uint8Array): Uint8Array {
    const half = raw.length / 2;
    const integer = (bytes: Uint8Array) => {
      let start = 0;
      while (start < bytes.length - 1 && bytes[start] === 0) {
        start++;
      }
      const trimmed = bytes.subarray(start);
      const padded =
        trimmed[0]! & 0x80
          ? this.concat(new Uint8Array([0]), trimmed)
          : trimmed;
      return this.concat(new Uint8Array([0x02, padded.length]), padded);
    };
    const body = this.concat(
      integer(raw.subarray(0, half)),
      integer(raw.subarray(half)),
    );
    return this.concat(new Uint8Array([0x30, body.length]), body);
  }

  protected coseAlgorithm(algorithm: MemoryAuthenticatorAlgorithm): number {
    return algorithm === "ES256" ? -7 : algorithm === "RS256" ? -257 : -8;
  }

  protected algorithmName(
    alg: number,
  ): MemoryAuthenticatorAlgorithm | undefined {
    return alg === -7
      ? "ES256"
      : alg === -257
        ? "RS256"
        : alg === -8
          ? "EdDSA"
          : undefined;
  }

  protected flip(bytes: Uint8Array): Uint8Array {
    const out = bytes.slice();
    const at = Math.floor(out.length / 2);
    out[at] = out[at]! ^ 0x01;
    return out;
  }

  protected async sha256(data: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(
      await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>),
    );
  }

  protected concat(...parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}
