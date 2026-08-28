/**
 * A template name as a reader should see it: `questReminder` becomes "Quest
 * reminder", `welcome-email` becomes "Welcome email".
 *
 * Display only. Everywhere the value is an identifier - the filter's option
 * values, the query sent to the API - keeps the raw name, and every call site
 * puts the raw name back within reach (a `title` on the cell, the sheet's own
 * description).
 *
 * Shared rather than local to the list, for the same reason the status tone
 * map is shared: the list and the detail sheet render the same field, and one
 * humanizing while the other did not is how the same template ended up with
 * two names on two adjacent surfaces.
 */
export const notificationTemplateLabel = (name: string): string => {
  const spaced = name
    .replace(/[-_.]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!spaced) return name;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
};
