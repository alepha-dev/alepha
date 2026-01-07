import { NodeSqliteProvider } from "alepha/orm";

export class DevToolsDatabaseProvider extends NodeSqliteProvider {
  public get name() {
    return "devtools";
  }

  protected readonly options = {
    path: ":memory:",
  };

  protected override async migrateDatabase(): Promise<void> {
    this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          level TEXT NOT NULL,
          message TEXT,
          service TEXT,
          module TEXT,
          context TEXT,
          app TEXT,
          data TEXT,
          timestamp INTEGER NOT NULL
        )
      `);
  }
}
