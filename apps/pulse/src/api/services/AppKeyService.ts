import { randomBytes } from "node:crypto";
import { $inject, AlephaError } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { $repository } from "alepha/orm";
import { type PulseApp, pulseApps } from "../entities/pulseApps.ts";

/**
 * Issues and checks the keys apps use to report.
 *
 * **A separate credential from anything a human holds.** Pulse's realm also
 * mints `api_keys`, and those carry the operator's roles — a key created there
 * can deploy, stop and remove apps. An ingest key must be able to do exactly
 * one thing, so it lives in its own table and is resolved by its own lookup;
 * the two are never interchangeable in either direction.
 *
 * That separation is enforced here rather than by convention, because the
 * tempting shortcut — reusing `api_keys` because it already exists — turns a
 * leaked telemetry key, of which there is one per app on every machine that
 * runs it, into a deploy credential.
 */
export class AppKeyService {
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly apps = $repository(pulseApps);

  /**
   * Mints a key, returning the only cleartext copy that will ever exist.
   *
   * Stored hashed for the same reason a password is: a database that leaks
   * should not be a fleet that leaks. The prefix is kept so the UI can name a
   * key without being able to reconstruct it.
   */
  generate(): { token: string; hash: string; prefix: string } {
    const token = `tk_${randomBytes(24).toString("base64url")}`;
    return {
      token,
      hash: this.crypto.hash(token),
      prefix: token.slice(0, 11),
    };
  }

  /**
   * Resolves a bearer token to the app it belongs to.
   *
   * Returns `undefined` for unknown *and* revoked keys alike: telling a caller
   * which of the two it is would let anyone probe for keys that once existed.
   */
  async resolve(token: string | undefined): Promise<PulseApp | undefined> {
    if (!token) {
      return undefined;
    }
    const app = await this.apps.findOne({
      where: { ingestKeyHash: this.crypto.hash(token) },
    });
    if (!app || app.revokedAt) {
      return undefined;
    }
    return app;
  }

  /**
   * Reads the bearer out of an Authorization header.
   *
   * Anything that is not exactly `Bearer <token>` yields `undefined` rather
   * than a best-effort parse: a header this service cannot read is a caller it
   * does not know.
   */
  bearer(header: string | undefined): string | undefined {
    if (!header?.startsWith("Bearer ")) {
      return undefined;
    }
    const token = header.slice(7).trim();
    return token || undefined;
  }

  /** Rejects with the one error shape the ingest endpoints answer with. */
  unauthorized(): AlephaError {
    return new AlephaError("Unknown or revoked ingest key");
  }
}
