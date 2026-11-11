import { $inject } from "alepha";
import {
  type AuthenticationOptionsJson,
  type AuthenticationResponseJson,
  Base64Url,
  type RegistrationOptionsJson,
  type RegistrationResponseJson,
} from "alepha/security";

/**
 * How a ceremony ended, for the UI to branch on. `cancelled` is quiet (the
 * user dismissed the prompt, or it timed out); `exists` means this device
 * already holds a passkey for the account; `unsupported` that the browser
 * has no WebAuthn; `error` is for the toaster.
 */
export type PasskeyCeremonyResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: "cancelled" | "exists" | "unsupported" | "error";
      error?: Error;
    };

/**
 * The browser's WebAuthn API, and nothing else: it knows
 * `navigator.credentials` and no route. A class in the container so a spec
 * substitutes it (`MemoryPasskeyClient` in `alepha/testing/webauthn`); a
 * component never calls `navigator.credentials` itself.
 *
 * It converts the server's JSON options (base64url) to the `ArrayBuffer`s
 * the browser wants and the browser's credential back to JSON, with
 * `PublicKeyCredential.parseCreationOptionsFromJSON`, `parseRequestOptionsFromJSON`
 * and `toJSON()` where the browser has them, and by hand where it does not
 * (older Safari and Chromium).
 */
export class PasskeyClient {
  protected readonly base64url = $inject(Base64Url);

  /**
   * Whether this browser can run a WebAuthn ceremony at all.
   */
  public isSupported(): boolean {
    return (
      typeof globalThis.PublicKeyCredential === "function" &&
      typeof globalThis.navigator?.credentials?.get === "function"
    );
  }

  /**
   * Whether the browser offers passkeys in the autofill of a text field
   * (conditional mediation).
   */
  public async isAutofillSupported(): Promise<boolean> {
    if (!this.isSupported()) {
      return false;
    }
    const check = (
      globalThis.PublicKeyCredential as unknown as {
        isConditionalMediationAvailable?: () => Promise<boolean>;
      }
    ).isConditionalMediationAvailable;
    return check ? await check.call(globalThis.PublicKeyCredential) : false;
  }

  /**
   * Run `navigator.credentials.create()` with the server's options.
   */
  public async create(
    options: RegistrationOptionsJson,
  ): Promise<PasskeyCeremonyResult<RegistrationResponseJson>> {
    if (!this.isSupported()) {
      return { ok: false, reason: "unsupported" };
    }
    try {
      const credential = (await navigator.credentials.create({
        publicKey: this.toCreationOptions(options),
      })) as PublicKeyCredential | null;
      if (!credential) {
        return { ok: false, reason: "cancelled" };
      }
      return {
        ok: true,
        value: this.toJson(credential) as RegistrationResponseJson,
      };
    } catch (error) {
      return this.failure(error, "create");
    }
  }

  /**
   * Run `navigator.credentials.get()` with the server's options. With
   * `mediation: "conditional"` the browser offers passkeys in the autofill
   * of an input whose `autocomplete` carries `webauthn`, until `signal`
   * aborts it.
   */
  public async get(
    options: AuthenticationOptionsJson,
    init: {
      mediation?: CredentialMediationRequirement;
      signal?: AbortSignal;
    } = {},
  ): Promise<PasskeyCeremonyResult<AuthenticationResponseJson>> {
    if (!this.isSupported()) {
      return { ok: false, reason: "unsupported" };
    }
    try {
      const credential = (await navigator.credentials.get({
        publicKey: this.toRequestOptions(options),
        mediation: init.mediation,
        signal: init.signal,
      })) as PublicKeyCredential | null;
      if (!credential) {
        return { ok: false, reason: "cancelled" };
      }
      return {
        ok: true,
        value: this.toJson(credential) as AuthenticationResponseJson,
      };
    } catch (error) {
      return this.failure(error, "get");
    }
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * The browser's errors, as results the UI can branch on.
   */
  protected failure<T>(
    error: unknown,
    ceremony: "create" | "get",
  ): PasskeyCeremonyResult<T> {
    // Read by name: a `DOMException` is not an `Error` instance everywhere.
    const name =
      typeof error === "object" && error !== null && "name" in error
        ? String((error as { name: unknown }).name)
        : "";
    if (name === "NotAllowedError" || name === "AbortError") {
      return { ok: false, reason: "cancelled" };
    }
    if (ceremony === "create" && name === "InvalidStateError") {
      return { ok: false, reason: "exists" };
    }
    return {
      ok: false,
      reason: "error",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  protected toCreationOptions(
    json: RegistrationOptionsJson,
  ): PublicKeyCredentialCreationOptions {
    const parse = (
      globalThis.PublicKeyCredential as unknown as {
        parseCreationOptionsFromJSON?: (
          json: unknown,
        ) => PublicKeyCredentialCreationOptions;
      }
    ).parseCreationOptionsFromJSON;
    if (parse) {
      return parse.call(globalThis.PublicKeyCredential, json);
    }
    return {
      ...json,
      challenge: this.buffer(json.challenge),
      user: { ...json.user, id: this.buffer(json.user.id) },
      excludeCredentials: json.excludeCredentials?.map((it) => ({
        ...it,
        id: this.buffer(it.id),
        transports: it.transports as AuthenticatorTransport[] | undefined,
      })),
    } as PublicKeyCredentialCreationOptions;
  }

  protected toRequestOptions(
    json: AuthenticationOptionsJson,
  ): PublicKeyCredentialRequestOptions {
    const parse = (
      globalThis.PublicKeyCredential as unknown as {
        parseRequestOptionsFromJSON?: (
          json: unknown,
        ) => PublicKeyCredentialRequestOptions;
      }
    ).parseRequestOptionsFromJSON;
    if (parse) {
      return parse.call(globalThis.PublicKeyCredential, json);
    }
    return {
      ...json,
      challenge: this.buffer(json.challenge),
      allowCredentials: json.allowCredentials?.map((it) => ({
        ...it,
        id: this.buffer(it.id),
        transports: it.transports as AuthenticatorTransport[] | undefined,
      })),
    } as PublicKeyCredentialRequestOptions;
  }

  /**
   * A credential to its JSON form: the browser's `toJSON()` when it has
   * one, else field by field.
   */
  protected toJson(credential: PublicKeyCredential): unknown {
    const withJson = credential as PublicKeyCredential & {
      toJSON?: () => unknown;
    };
    if (typeof withJson.toJSON === "function") {
      return withJson.toJSON();
    }
    const response = credential.response as AuthenticatorResponse & {
      attestationObject?: ArrayBuffer;
      authenticatorData?: ArrayBuffer;
      signature?: ArrayBuffer;
      userHandle?: ArrayBuffer | null;
      getTransports?: () => string[];
    };
    const encode = (buffer: ArrayBuffer) => this.base64url.encode(buffer);
    const base = {
      id: credential.id,
      rawId: encode(credential.rawId),
      type: "public-key" as const,
      authenticatorAttachment:
        (credential as { authenticatorAttachment?: string })
          .authenticatorAttachment ?? undefined,
      clientExtensionResults: credential.getClientExtensionResults(),
    };
    if (response.attestationObject) {
      return {
        ...base,
        response: {
          clientDataJSON: encode(response.clientDataJSON),
          attestationObject: encode(response.attestationObject),
          transports: response.getTransports?.() ?? [],
        },
      };
    }
    return {
      ...base,
      response: {
        clientDataJSON: encode(response.clientDataJSON),
        authenticatorData: encode(response.authenticatorData!),
        signature: encode(response.signature!),
        ...(response.userHandle
          ? { userHandle: encode(response.userHandle) }
          : {}),
      },
    };
  }

  protected buffer(text: string): ArrayBuffer {
    return this.base64url.decode(text).slice().buffer as ArrayBuffer;
  }
}
