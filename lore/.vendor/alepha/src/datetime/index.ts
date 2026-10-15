import { $module } from "alepha";

import { $interval } from "./primitives/$interval.ts";
import { DateTimeProvider } from "./providers/DateTimeProvider.ts";

export * from "./primitives/$interval.ts";
export * from "./providers/DateTimeProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Date and time operations.
 *
 * **Features:**
 * - Recurring interval definitions
 * - Duration helpers (numbers, `[n, unit]` tuples and `Duration` objects)
 * - Timezone support
 * - Portable date-time and duration values
 *
 * @module alepha.datetime
 */
export const AlephaDateTime = $module({
  name: "alepha.datetime",
  primitives: [$interval],
  services: [DateTimeProvider],
});
