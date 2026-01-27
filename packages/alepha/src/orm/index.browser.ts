import { $module } from "alepha";
import { AlephaDateTime } from "alepha/datetime";

export * from "./index.shared.ts";

export const AlephaOrm = $module({
  name: "alepha.orm",
  primitives: [],
  services: [AlephaDateTime],
});
