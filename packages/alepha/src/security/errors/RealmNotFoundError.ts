import { AlephaError } from "alepha";

/**
 * A realm the configuration does not declare.
 *
 * An `AlephaError` (500): every place that throws it is reading the app's own
 * configuration (a role, an issuer update, a lookup by name, the default
 * realm), so a missing realm is a mistake in the app, not in the request. A
 * token is matched to its realm by the key that verified it, so an unknown
 * issuer is an `InvalidTokenError` (401), never this.
 */
export class RealmNotFoundError extends AlephaError {
  public override readonly name = "RealmNotFoundError";

  constructor(realm: string) {
    super(`Realm '${realm}' not found`);
  }
}
