export interface ActorHostDeclaration {
  exportName: string;
  module: string;
  moduleExport: string;
  binding: string;
  backend: "sqlite" | "kv";
}
