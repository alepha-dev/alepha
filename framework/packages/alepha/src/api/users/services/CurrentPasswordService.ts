import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { $rateLimit } from "alepha/rate-limit";
import { CryptoProvider } from "alepha/security";
import { TooManyRequestsError } from "alepha/server";

import { SessionAudits } from "../audits/SessionAudits.ts";
import type { AttemptBudget } from "../interfaces/AttemptBudget.ts";
import { RealmProvider } from "../providers/RealmProvider.ts";

/**
 * The check of an account's current password outside the login: the
 * password change, the account deletion and the password proof of a passkey,
 * a TOTP enrolment or an unlink.
 *
 * Every one of them compares a guess with the same hash the login protects,
 * so they all spend the login's own `login:account` budget (per realm and
 * user, limit and window from the realm's `loginRateLimit`): a session holder
 * guessing the password here runs out of attempts exactly as at the login
 * page, and locks the login with it.
 */
export class CurrentPasswordService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly realmProvider = $inject(RealmProvider);
  protected readonly cryptoProvider = $inject(CryptoProvider);

  /**
   * The account budget of the login, owned here so that the login and the
   * current-password checks count against one counter. Fails closed: a
   * counter store that cannot answer refuses the check.
   */
  public readonly attempts = $rateLimit({
    name: "login:account",
    limit: (input: AttemptBudget) => input.max,
    window: (input: AttemptBudget) => input.windowMs,
    key: (input: AttemptBudget) => input.key,
  });

  /**
   * Whether `password` is the account's current password.
   *
   * The slot is taken before the compare and given back by a right password
   * only. An account with no password and a wrong password answer `false`.
   * A spent budget throws `TooManyRequestsError`, whatever the password, and
   * the failure that spends it writes the `security.rate_limited` audit entry
   * the login writes. No mail is sent from here.
   */
  public async verify(
    userId: string,
    password: string,
    realmName?: string,
  ): Promise<boolean> {
    const realm = this.realmProvider.getRealm(realmName);
    const credentials = await this.realmProvider
      .identityRepository(realmName)
      .findOne({
        where: { userId: { eq: userId }, provider: { eq: "credentials" } },
      });
    if (!credentials?.password) {
      return false;
    }

    const { loginRateLimit } = await realm.getSettings();
    const attempt = await this.attempts.consume({
      key: `${realm.name}:${userId}`,
      max: loginRateLimit.accountMaxAttempts,
      windowMs: loginRateLimit.windowMs,
    });
    if (!attempt.allowed) {
      this.log.warn("Current password check blocked, account budget spent", {
        userId,
        realm: realm.name,
        reason: attempt.reason,
      });
      // Said as what it is. The caller is signed in and asks about their
      // own account, so this tells nobody anything, and "incorrect" for a
      // right password sends its owner hunting for a typo.
      throw new TooManyRequestsError("Too many attempts. Try again later.");
    }

    const valid = await this.cryptoProvider.verifyPassword(
      password,
      credentials.password,
    );
    if (valid) {
      if (attempt.ticket) {
        await this.attempts.refund(attempt.ticket);
      }
      return true;
    }

    // This failure filling the counter is what "just locked" means: the
    // audit entry the login writes at the same moment.
    if (
      attempt.count === loginRateLimit.accountMaxAttempts &&
      this.alepha.has(SessionAudits)
    ) {
      await this.alepha.inject(SessionAudits).security.log("rate_limited", {
        userRealm: realm.name,
        resourceId: userId,
        success: false,
        description:
          "Account temporarily locked due to too many failed current-password checks",
        metadata: { userId },
      });
    }
    return false;
  }
}
