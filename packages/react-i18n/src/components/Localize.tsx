import { TypeBoxError, TypeProvider } from "@alepha/core";
import { type DateTime, DateTimeProvider } from "@alepha/datetime";
import { useInject } from "@alepha/react";
import { useI18n } from "../hooks/useI18n.ts";

export interface LocalizeProps {
  value: string | number | Date | DateTime | TypeBoxError;
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
  date?: string | "fromNow" | Intl.DateTimeFormatOptions;
  /**
   * Timezone to display dates in (when value is a Date or DateTime)
   * Uses IANA timezone names (e.g., "America/New_York", "Europe/Paris", "Asia/Tokyo")
   * @see https://day.js.org/docs/en/timezone/timezone
   */
  timezone?: string;
}

const Localize = (props: LocalizeProps) => {
  const i18n = useI18n();
  const dateTimeProvider = useInject(DateTimeProvider);

  // Handle numbers
  if (typeof props.value === "number") {
    if (props.number) {
      return new Intl.NumberFormat(i18n.lang, props.number).format(props.value);
    }
    return i18n.numberFormat.format(props.value);
  }

  // Handle dates
  if (
    props.value instanceof Date ||
    dateTimeProvider.isDateTime(props.value) ||
    (typeof props.value === "string" && props.date)
  ) {
    // Convert to DateTime with locale applied
    let dt = dateTimeProvider.of(props.value);

    // Apply timezone if specified
    if (props.timezone) {
      dt = dt.tz(props.timezone);
    }

    // Format using dayjs format string
    if (typeof props.date === "string") {
      if (props.date === "fromNow") {
        return dt.locale(i18n.lang).fromNow();
      }
      return dt.locale(i18n.lang).format(props.date);
    }

    // Format using Intl.DateTimeFormatOptions
    if (props.date) {
      const options = props.timezone
        ? { ...props.date, timeZone: props.timezone }
        : props.date;
      return new Intl.DateTimeFormat(i18n.lang, options).format(dt.toDate());
    }

    // Default formatting with timezone
    if (props.timezone) {
      return new Intl.DateTimeFormat(i18n.lang, {
        timeZone: props.timezone,
      }).format(dt.toDate());
    }

    // Default formatting
    return i18n.dateFormat.format(dt.toDate());
  }

  // Handle TypeBox errors
  if (props.value instanceof TypeBoxError) {
    return TypeProvider.translateError(props.value, i18n.lang);
  }

  // Return string values as-is
  return props.value;
};

export default Localize;
