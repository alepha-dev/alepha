import { AlephaError } from "alepha";

/**
 * What deleting a Lore account costs, line by line, from the module whose
 * rows go with it (#E75, #Q2624): Work's authored quests, Deploy's owned
 * estates. `AccountDeleteWarning` is core and names neither.
 *
 * ## ⚠️ The warnings are frozen once read
 *
 * Each is a HOOK the warning calls once per render, in a loop, which is only
 * legal while the loop is the same length on every render. The set closes
 * the first time it is read; every shell registers from its constructor.
 */
export class AccountDeletionRegistry {
  protected readonly entries: AccountDeletionWarning[] = [];
  protected frozen = false;

  public register(warning: AccountDeletionWarning): void {
    if (this.frozen) {
      throw new AlephaError(
        `Account deletion warning '${warning.key}' registered after the warnings were first read`,
      );
    }
    this.entries.push(warning);
    this.entries.sort((a, b) => a.order - b.order);
  }

  public warnings(): readonly AccountDeletionWarning[] {
    this.frozen = true;
    return this.entries;
  }
}

export interface AccountDeletionWarning {
  key: string;
  order: number;
  /**
   * A HOOK: the sentence saying what goes, or `undefined` while it is
   * loading, when it failed, or when nothing goes. A failed count must not
   * block the dialog or hide another line, so it is quiet.
   */
  useLine: () => string | undefined;
}
