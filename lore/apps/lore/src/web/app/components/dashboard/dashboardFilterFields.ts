import { type ZType, z } from "alepha";

/**
 * One choice the Add-card wizard can offer for a metric's filters.
 *
 * `multiple` is the difference between "which status" and "which statuses":
 * the active-quests metric's whole point is the SUM of two of them, so its
 * field is an array and the control has to let both be on at once.
 */
export interface DashboardFilterField {
  name: string;
  options: string[];
  multiple: boolean;
}

/**
 * Read a metric's filter vocabulary off its own Zod schema.
 *
 * This is what makes the wizard generated rather than written per tile:
 * adding a metric means adding a registry entry, and its filter step appears
 * because its schema says what it accepts, not because anyone wrote a form.
 *
 * Deliberately narrow. It understands enums and arrays of enums, which is
 * the whole v1 vocabulary, and returns nothing for anything else — a metric
 * that one day needs a date range or a number gets a control added here, in
 * one place, rather than a bespoke step of its own.
 *
 * Fields with fewer than two options are dropped: a select with one entry is
 * not a choice, and offering it makes the wizard longer without making it
 * more capable.
 */
export const dashboardFilterFields = (
  schema: ZType,
): DashboardFilterField[] => {
  const shape = z.schema.shape(schema);
  const fields: DashboardFilterField[] = [];

  for (const [name, raw] of Object.entries(shape)) {
    const field = z.schema.unwrap(raw);

    if (z.schema.isEnum(field)) {
      fields.push({
        name,
        options: z.schema.enumValues(field),
        multiple: false,
      });
      continue;
    }

    if (z.schema.isArray(field)) {
      const element = z.schema.unwrap(z.schema.element(field));
      if (element && z.schema.isEnum(element)) {
        fields.push({
          name,
          options: z.schema.enumValues(element),
          multiple: true,
        });
      }
    }
  }

  return fields.filter((field) => field.options.length > 1);
};
