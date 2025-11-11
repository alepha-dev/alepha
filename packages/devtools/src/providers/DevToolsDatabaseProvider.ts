import { NodeSqliteProvider } from "@alepha/postgres";

export class DevToolsDatabaseProvider extends NodeSqliteProvider {
  public get name() {
    return "devtools";
  }

  protected readonly options = {
    path: ":memory:",
  };
}
