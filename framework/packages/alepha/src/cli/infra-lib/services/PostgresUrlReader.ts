import { AlephaError } from "alepha";

/**
 * Parses a Postgres `DATABASE_URL` for the deploy path.
 *
 * ⚠️ The runtime's own `TypeError: Invalid URL` carries the whole URL,
 * password included, as its `input` property, so it must never leave a
 * deploy. Every parse of a `DATABASE_URL` in this module goes through
 * {@link read}, which throws an error naming the variable and nothing of its
 * value, with no cause.
 */
export class PostgresUrlReader {
  public read(url: string): URL {
    try {
      return new URL(url);
    } catch {
      throw new AlephaError(
        'DATABASE_URL is not a URL that can be parsed. A user or password holding "/", "@", ":", "#" or "?" must be percent-encoded.',
      );
    }
  }
}
