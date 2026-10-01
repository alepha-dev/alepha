import { $module } from "alepha";
import { AlephaDateTime } from "alepha/datetime";

export * from "./index.shared.ts";

export const AlephaOrm = $module({
  name: "alepha.orm",
  primitives: [],
  // `AlephaDateTime` is a MODULE, not a service — every other entrypoint
  // lists it under `imports`.
  imports: [AlephaDateTime],
});
