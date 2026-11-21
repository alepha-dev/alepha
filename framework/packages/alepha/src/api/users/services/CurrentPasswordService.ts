import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import { $rateLimit } from "alepha/rate-limit";
import { CryptoProvider } from "alepha/security";

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
   * only. An account with no password, a spent budget and a wrong password
   * all answer `false`: the caller says one thing for the three.
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
      return false;
    }

    const valid = await this.cryptoProvider.verifyPassword(
      password,
      credentials.password,
    );
    if (valid && attempt.ticket) {
      await this.attempts.refund(attempt.ticket);
    }
    return valid;
  }
}
