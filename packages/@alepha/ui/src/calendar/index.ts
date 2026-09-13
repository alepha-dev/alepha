/**
 * A calendar, on react-day-picker.
 *
 * `Calendar` follows the app's active language for month and weekday names.
 * Opt-in: only the date controls of `@alepha/ui/form` use it, and they load it
 * lazily, when their popover first opens, so a form does not download
 * react-day-picker and date-fns until a date is being picked.
 *
 * @module alepha.ui.calendar
 */

export { Calendar, CalendarDayButton } from "./Calendar.tsx";
