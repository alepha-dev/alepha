import { $inject, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import { RealmProvider } from "../providers/RealmProvider.ts";

/**
 * Derive stable, URL-safe usernames from email addresses.
 *
 * Used by the registration flow when `realm.settings.username === "email"`,
 * and reusable from any custom user-creation site (e.g. an OAuth-only flow
 * that wants the same handle convention).
 *
 * **Slug rule** — the local-part of the email is kept as-is (gmail
 * `+suffix` retained for predictability). Everything outside `[a-z0-9]` is
 * replaced with `-`, runs of `-` are collapsed, leading/trailing `-` are
 * trimmed, lowercased. If the result is shorter than {@link MIN_LENGTH} it
 * is padded with random alphanumerics. Result is clamped to
 * {@link MAX_LENGTH}.
 *
 * **Collision retry** — `pickAvailable()` checks the realm's `users` table
 * and the realm's `usernameBlocklist`. On hit, it appends `-<4 random>` and
 * retries up to {@link MAX_RETRIES} times. Best-effort against concurrent
 * registrations: the unique index on `(realm, lower(username))` is the
 * authoritative race guard, callers that hit a unique-violation should
 * call `pickAvailable` again with a fresh suffix.
 *
 * @see RegistrationService.createRegistrationIntent
 */
export class UsernameSlugger {
  protected readonly realmProvider = $inject(RealmProvider);
  protected readonly log = $logger();

  /**
   * Floor for derived usernames. Shorter slugs are padded with random
   * alphanumerics. Matches the lower bound of the default `usernameRegExp`.
   */
  static readonly MIN_LENGTH = 3;

  /**
   * Ceiling for derived usernames. Matches the upper bound of the default
   * `usernameRegExp` and gives enough headroom for the random suffix added
   * on collisions.
   */
  static readonly MAX_LENGTH = 30;

  /**
   * Length of the random suffix appended on collision (e.g. `-3dp6`).
   * 36⁴ ≈ 1.6M variants per base — plenty for a tiny number of retries.
   */
  static readonly SUFFIX_LENGTH = 4;

  /**
   * How many times `pickAvailable` retries before giving up.
   */
  static readonly MAX_RETRIES = 5;

  /**
   * Alphabet used for the random suffix and for padding short slugs.
   */
  static readonly ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

  /**
   * Default replacement when the email's local-part contains no
   * `[a-z0-9]` characters at all (rare but possible: `é@example.com`).
   */
  static readonly EMPTY_LOCAL_FALLBACK = "user";

  /**
   * Sanitize an email into a base username slug.
   *
   * Pure function — no DB access. Always returns a string that satisfies
   * `^[a-z0-9-]{MIN_LENGTH,MAX_LENGTH}$`.
   *
   * @example
   * slug("ni.foures+testkv@gmail.com") // "ni-foures-testkv"
   * slug("john.doe@example.com")       // "john-doe"
   * slug("é@example.com")              // "user-XXX" (padded)
   */
  public slug(email: string | null | undefined): string {
    const raw = (email ?? "").trim();
    const at = raw.indexOf("@");
    const local = at > 0 ? raw.slice(0, at) : raw;

    const cleaned = local
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    let result = cleaned || UsernameSlugger.EMPTY_LOCAL_FALLBACK;

    if (result.length < UsernameSlugger.MIN_LENGTH) {
      const needed = UsernameSlugger.MIN_LENGTH - result.length;
      result += this.randomSuffix(needed);
    }

    return this.clamp(result);
  }

  /**
   * Find an available username for the realm, starting from `base`.
   *
   * Returns `base` when nothing collides. On a hit (existing row OR
   * blocklisted name) appends `-<4 random>` and tries again, up to
   * {@link MAX_RETRIES} times.
   *
   * The check is best-effort: a concurrent registration may still claim
   * the same value before the caller's INSERT runs, in which case the DB
   * unique index throws and the caller should retry.
   */
  public async pickAvailable(
    realmName: string | undefined,
    base: string,
  ): Promise<string> {
    const blocklist = await this.getBlocklist(realmName);
    const repo = this.realmProvider.userRepository(realmName);
    const realm = this.realmProvider.getRealm(realmName);

    const isAvailable = async (candidate: string): Promise<boolean> => {
      if (this.isBlockedAgainst(candidate, blocklist)) {
        return false;
      }
      const existing = await repo.findOne({
        where: {
          realm: { eq: realm.name },
          username: { eqInsensitive: candidate },
        },
      });
      return !existing;
    };

    if (await isAvailable(base)) {
      return base;
    }

    // Reserve room for "-" + suffix at the end of the candidate.
    const reserve = 1 + UsernameSlugger.SUFFIX_LENGTH;
    const trimmedBase =
      base.length > UsernameSlugger.MAX_LENGTH - reserve
        ? base.slice(0, UsernameSlugger.MAX_LENGTH - reserve)
        : base;

    for (let i = 0; i < UsernameSlugger.MAX_RETRIES; i++) {
      const candidate = `${trimmedBase}-${this.randomSuffix(
        UsernameSlugger.SUFFIX_LENGTH,
      )}`;
      if (await isAvailable(candidate)) {
        return candidate;
      }
    }

    throw new AlephaError(
      `Could not find an available username starting from "${base}" after ${UsernameSlugger.MAX_RETRIES} attempts.`,
    );
  }

  /**
   * Check a name against the realm's `usernameBlocklist`. Case-insensitive.
   */
  public async isBlocked(
    realmName: string | undefined,
    name: string,
  ): Promise<boolean> {
    const blocklist = await this.getBlocklist(realmName);
    return this.isBlockedAgainst(name, blocklist);
  }

  // -------------------------------------------------------------------------

  protected async getBlocklist(
    realmName: string | undefined,
  ): Promise<Set<string>> {
    const realm = this.realmProvider.getRealm(realmName);
    const settings = await realm.getSettings();
    const list = settings?.usernameBlocklist ?? [];
    return new Set(list.map((b) => b.toLowerCase()));
  }

  protected isBlockedAgainst(name: string, blocklist: Set<string>): boolean {
    return blocklist.has(name.toLowerCase());
  }

  protected clamp(s: string): string {
    return s.length > UsernameSlugger.MAX_LENGTH
      ? s.slice(0, UsernameSlugger.MAX_LENGTH)
      : s;
  }

  protected randomSuffix(length: number): string {
    const chars = UsernameSlugger.ALPHABET;
    let out = "";
    for (let i = 0; i < length; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }
}
