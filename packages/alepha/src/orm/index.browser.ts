import { $module } from "alepha";
import { AlephaDateTime } from "alepha/datetime";

export * from "./index.shared.ts";

export const AlephaPostgres = $module({
  name: "alepha.postgres",
  primitives: [],
  services: [AlephaDateTime],
});
