import { NodeSqliteProvider } from "alepha/orm";

/**
 * SQLite that refuses a statement binding more than 100 values, which is
 * what Cloudflare D1 does in production (`too many SQL variables`). The
 * in-memory SQLite every other spec runs on takes 32766, so an unbounded
 * `inArray` over a list that grows with the data passes there and fails on
 * lore.alepha.app the day the list crosses 100 (#Q3959).
 *
 * Provide it before `AlephaOrm` is registered:
 * `alepha.with({ provide: DatabaseProvider, use: D1CeilingProvider })`.
 */
export class D1CeilingProvider extends NodeSqliteProvider {
  public override readonly maxBoundParameters = 100;

  protected override initDrizzle(): void {
    const database = this.sqlite as unknown as {
      prepare: (text: string) => unknown;
    };
    const prepare = database.prepare.bind(database);
    database.prepare = (text: string) => {
      const bound = text.split("?").length - 1;
      if (bound > this.maxBoundParameters) {
        throw new Error(`too many SQL variables (${bound})`);
      }
      return prepare(text);
    };
    super.initDrizzle();
  }
}
