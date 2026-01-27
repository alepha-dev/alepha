import { SqliteProvider } from "alepha/orm";

export class DevToolsDatabaseProvider extends SqliteProvider {
  public get name() {
    return "";
  }

  protected readonly options = {
    path: ":memory:",
  };

  public override async migrate(): Promise<void> {
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
