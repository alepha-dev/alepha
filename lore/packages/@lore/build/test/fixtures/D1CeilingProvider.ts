import { NodeSqliteProvider } from "alepha/orm";

/**
 * SQLite that refuses a statement binding more than 100 values, as
 * Cloudflare D1 does (`too many SQL variables`); the same class as
 * `apps/lore/test/fixtures/D1CeilingProvider.ts`, which a package spec
 * cannot import.
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
