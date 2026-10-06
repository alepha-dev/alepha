import { AlephaError } from "alepha";
import { $logger } from "alepha/logger";

/**
 * Runs a step that follows an action's main write, and never lets it fail
 * the action (#Q2555).
 *
 * Lore runs on D1, where nothing rolls a committed write back. A link sync or
 * a mention that throws after the row it belongs to has been written used to
 * answer 500 for a change that happened, and invite a retry that repeated
 * it. Through here the failure is logged at error level, with the `Error`
 * itself as data, so the sigil reports it as a blight with its stack, and
 * the action carries on.
 *
 * Audits do not come through here: `LoreAuditService.record` is best effort
 * on its own.
 *
 * ⚠️ Only correct with no transaction open. On Postgres a failed statement
 * aborts the surrounding transaction, so "catch and continue" inside one
 * leaves every later statement failing. Lore never runs on Postgres and holds
 * no `$transactional`.
 */
export class BestEffort {
  protected readonly log = $logger();

  /**
   * Run `step` and answer its value; on a throw, log it at error level
   * under `label` and answer `undefined`.
   */
  public async run<T>(
    label: string,
    step: () => Promise<T>,
  ): Promise<T | undefined> {
    try {
      return await step();
    } catch (error) {
      this.log.error(
        label,
        error instanceof Error
          ? error
          : new AlephaError(String(error), { cause: error }),
      );
      return undefined;
    }
  }
}
