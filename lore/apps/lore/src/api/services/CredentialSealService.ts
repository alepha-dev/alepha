import { $inject, AlephaError } from "alepha";
import {
  CryptoProvider,
  DEFAULT_SECRET_KEY_VALUE,
  SecretProvider,
} from "alepha/crypto";

/**
 * Seals a third-party credential so a database that leaks is not a set of
 * cloud accounts that leaks.
 *
 * ## Why this is not `EstateTokenService`
 *
 * A `bay` secret is one Lore minted, so it is stored hashed and never read
 * back: nothing needs the cleartext again. A cloudflare token is one its
 * owner pasted, and Lore has to replay it against Cloudflare on every probe
 * and every deploy, so it must be recoverable. Recoverable is not the same
 * as readable: it is encrypted at rest with a key derived from
 * `APP_SECRET`, and the only way back out is {@link open} on a running
 * instance.
 *
 * ## The key derives from `APP_SECRET`, and there is no second variable
 *
 * `key = hmac(purpose, SecretProvider.secretKey)`, which `CryptoProvider`
 * then sha256s into the AES key. Folio #96 designed a second
 * `ALEPHA_SECRETS_KEY`; the owner's ruling of 2026-09-05 removed it, because
 * Lore is an on-premise app one operator runs, not a SaaS with a key
 * hierarchy. Three things follow: the `$APP_SECRET` interpolation trap
 * cannot occur when there is no second variable to interpolate into,
 * `APP_SECRET_FILE` self-hosting keeps working with no second generated
 * file, and the framework's own precedent is weaker than this (`MfaService`
 * seals TOTP secrets with `APP_SECRET` verbatim, with no label at all).
 *
 * `purpose` is the label, and it is what keeps two callers apart: an estate
 * token is sealed under `lore:estates:v1` and #1813's app secrets under
 * `lore:app-secrets:v1`, so a ciphertext moved from one column to the other
 * fails to open rather than decrypting into the wrong context. The label is
 * also versioned, so a future scheme change is a new label rather than a
 * silent re-interpretation of old rows.
 *
 * ## Rotating `APP_SECRET` re-seals every row
 *
 * That is the accepted cost of one secret. {@link KEY_VERSION} is written
 * beside each sealed value so the re-seal is a script rather than a crisis:
 * open with the old secret, seal with the new, bump the version. The script
 * is not in this epic; the column is, because it cannot be retrofitted
 * cheaply.
 */
export class CredentialSealService {
  /**
   * The label for an estate's cloud credential (#1629).
   */
  public static readonly ESTATE_PURPOSE = "lore:estates:v1";

  /**
   * Which derivation sealed a value, written to `credentialKeyVersion`.
   *
   * One scheme exists, so every row says `1`. It is stored anyway because a
   * column added after the rows exist cannot say anything true about them.
   */
  public static readonly KEY_VERSION = 1;

  protected readonly crypto = $inject(CryptoProvider);
  protected readonly secrets = $inject(SecretProvider);

  /**
   * Seals a credential, returning `iv:tag:ciphertext` in hex.
   */
  seal(plaintext: string, purpose: string): string {
    if (!plaintext) {
      throw new AlephaError("Refusing to seal an empty credential");
    }
    return this.crypto.encrypt(plaintext, this.keyFor(purpose));
  }

  /**
   * Opens a sealed credential, or throws.
   *
   * A wrong purpose, a tampered ciphertext and a rotated `APP_SECRET` all
   * fail the same way, as an authentication tag mismatch: AES-GCM cannot
   * tell a wrong key from a wrong message, and neither can this.
   */
  open(sealed: string, purpose: string): string {
    return this.crypto.decrypt(sealed, this.keyFor(purpose));
  }

  /**
   * Derives the sealing key, refusing the published default secret.
   *
   * ⚠️ Refused in **every** environment, tests included, which is stricter
   * than `SecretProvider` itself: that one throws only under
   * `isProduction()` and warns elsewhere, so a staging or self-hosted Lore
   * would seal real cloud tokens under a constant published in this
   * repository and look perfectly healthy. A credential sealed with a key
   * everyone knows is not sealed. Specs that seal pass an `APP_SECRET` in
   * `Alepha.create({ env })`; `apps/lore/e2e/_fixtures.ts` already does.
   */
  protected keyFor(purpose: string): string {
    const secret = this.secrets.secretKey;
    if (!secret || secret === DEFAULT_SECRET_KEY_VALUE) {
      throw new AlephaError(
        "APP_SECRET is the built-in default, so credentials cannot be sealed. " +
          "Set a strong, unique APP_SECRET: the default is public, and a " +
          "credential sealed with it is readable by anyone holding the database.",
      );
    }
    return this.crypto.hmac(purpose, secret);
  }
}
