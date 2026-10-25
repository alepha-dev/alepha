/**
 * An open database transaction.
 *
 * What a `transaction()` callback receives, and what every repository method
 * takes as its `tx` option. It is opaque on purpose: `alepha/orm` does not
 * freeze the driver's transaction object, whose shape belongs to drizzle.
 * The drizzle handle behind it is reached through `alepha/orm/drizzle`, which
 * sits outside semver.
 */
export interface DbTransaction {
  readonly "~dbTransaction": true;
}
