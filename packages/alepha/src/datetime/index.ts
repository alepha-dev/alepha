import { $module } from "alepha";
import { $interval } from "./primitives/$interval.ts";
import { DateTimeProvider } from "./providers/DateTimeProvider.ts";

export * from "./primitives/$interval.ts";
export * from "./providers/DateTimeProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaDateTime = $module({
  name: "alepha.datetime",
  primitives: [$interval],
  services: [DateTimeProvider],
});
