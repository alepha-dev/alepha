import type { SchemaValidationError } from "alepha";
import type { DateTime } from "alepha/datetime";

import { useI18n } from "../hooks/useI18n.ts";

export interface LocalizeProps {
  value: string | number | Date | DateTime | SchemaValidationError;
  /**
   * Options for number formatting (when value is a number)
   * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/NumberFormat
   */
  number?: Intl.NumberFormatOptions;
  /**
   * Options for date formatting (when value is a Date or DateTime)
   * Can be:
   * - A dayjs format string (e.g., "LLL", "YYYY-MM-DD", "dddd, MMMM D YYYY")
   * - "fromNow" for relative time (e.g., "2 hours ago")
   * - Intl.DateTimeFormatOptions for native formatting
   * @see https://day.js.org/docs/en/display/format
   * @see https://day.js.org/docs/en/display/from-now
   */
  date?: (string & {}) | "fromNow" | Intl.DateTimeFormatOptions;
  /**
   * Timezone to display dates in (when value is a Date or DateTime)
   * Uses IANA timezone names (e.g., "America/New_York", "Europe/Paris", "Asia/Tokyo")
   * @see https://day.js.org/docs/en/timezone/timezone
   */
  timezone?: string;
}

const Localize = (props: LocalizeProps) => {
  const i18n = useI18n();
  return i18n.l(props.value, props);
};

export default Localize;
