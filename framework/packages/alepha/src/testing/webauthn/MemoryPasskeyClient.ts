import { $inject } from "alepha";
import { type PasskeyCeremonyResult, PasskeyClient } from "alepha/react/auth";
import type {
  AuthenticationOptionsJson,
  AuthenticationResponseJson,
  RegistrationOptionsJson,
  RegistrationResponseJson,
} from "alepha/security";

import {
  type MemoryAssertionOptions,
  MemoryAuthenticator,
  type MemoryRegistrationOptions,
} from "./MemoryAuthenticator.ts";

/**
 * A {@link PasskeyClient} whose device is a {@link MemoryAuthenticator}: the
 * browser side of passkeys, for specs. Substitute it for `PasskeyClient`:
 *
 * ```ts
 * alepha.with({ provide: PasskeyClient, use: MemoryPasskeyClient });
 * ```
 *
 * A conditional (autofill) ceremony stays pending until
 * {@link pickAutofill} answers it or its signal aborts, as a browser's does
 * until the user picks a passkey.
 */
export class MemoryPasskeyClient extends PasskeyClient {
  protected readonly device = $inject(MemoryAuthenticator);

  /**
   * What `isSupported()` answers.
   */
  public supported = true;

  /**
   * What `isAutofillSupported()` answers.
   */
  public autofill = true;

  /**
   * The next ceremony ends as if the user dismissed it.
   */
  public cancelNext = false;

  /**
   * Knobs for the next ceremonies, passed to the authenticator.
   */
  public knobs: MemoryRegistrationOptions & MemoryAssertionOptions = {};

  /**
   * Conditional ceremonies waiting for the user, oldest first.
   */
  public readonly pending: Array<{
    options: AuthenticationOptionsJson;
    resolve: (
      result: PasskeyCeremonyResult<AuthenticationResponseJson>,
    ) => void;
  }> = [];

  /**
   * How many ceremonies ran, by kind, aborted ones included.
   */
  public readonly calls = { create: 0, get: 0, conditional: 0, aborted: 0 };

  public override isSupported(): boolean {
    return this.supported;
  }

  public override async isAutofillSupported(): Promise<boolean> {
    return this.supported && this.autofill;
  }

  public override async create(
    options: RegistrationOptionsJson,
  ): Promise<PasskeyCeremonyResult<RegistrationResponseJson>> {
    this.calls.create++;
    if (!this.supported) {
      return { ok: false, reason: "unsupported" };
    }
    if (this.takeCancel()) {
      return { ok: false, reason: "cancelled" };
    }
    try {
      return { ok: true, value: await this.device.create(options, this.knobs) };
    } catch (error) {
      return this.failure(error, "create");
    }
  }

  public override async get(
    options: AuthenticationOptionsJson,
    init: {
      mediation?: CredentialMediationRequirement;
      signal?: AbortSignal;
    } = {},
  ): Promise<PasskeyCeremonyResult<AuthenticationResponseJson>> {
    if (!this.supported) {
      return { ok: false, reason: "unsupported" };
    }
    if (init.mediation === "conditional") {
      this.calls.conditional++;
      return new Promise((resolve) => {
        const entry = { options, resolve };
        this.pending.push(entry);
        init.signal?.addEventListener("abort", () => {
          const at = this.pending.indexOf(entry);
          if (at >= 0) {
            this.pending.splice(at, 1);
          }
          this.calls.aborted++;
          resolve({ ok: false, reason: "cancelled" });
        });
      });
    }
    this.calls.get++;
    if (this.takeCancel()) {
      return { ok: false, reason: "cancelled" };
    }
    try {
      return { ok: true, value: await this.device.get(options, this.knobs) };
    } catch (error) {
      return this.failure(error, "get");
    }
  }

  /**
   * The user picks a passkey from the autofill of the oldest pending
   * conditional ceremony.
   */
  public async pickAutofill(): Promise<void> {
    const entry = this.pending.shift();
    if (!entry) {
      throw new TypeError("No conditional ceremony is waiting");
    }
    try {
      entry.resolve({
        ok: true,
        value: await this.device.get(entry.options, this.knobs),
      });
    } catch (error) {
      entry.resolve(this.failure(error, "get"));
    }
  }

  protected takeCancel(): boolean {
    const cancel = this.cancelNext;
    this.cancelNext = false;
    return cancel;
  }
}
