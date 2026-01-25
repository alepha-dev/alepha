import { $module } from "alepha";
import { $interval } from "./primitives/$interval.ts";
import { DateTimeProvider } from "./providers/DateTimeProvider.ts";

export * from "./primitives/$interval.ts";
export * from "./providers/DateTimeProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | type | quality | stability |
 * |------|---------|-----------|
 * | tooling | standard | stable |
 *
 * Date and time operations.
 *
 * **Features:**
 * - Recurring interval definitions
 * - Duration parsing (ISO 8601, human-readable)
 * - Timezone support
 * - Dayjs integration
 *
 * @module alepha.datetime
 */
export const AlephaDateTime = $module({
  name: "alepha.datetime",
  primitives: [$interval],
  services: [DateTimeProvider],
});
