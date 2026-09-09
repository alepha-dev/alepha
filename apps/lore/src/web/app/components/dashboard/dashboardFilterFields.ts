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
  /**
   * Where the options come from, when the schema could not say.
   *
   * ⚠️ Set only for a field the metric declared in `filterSources`. Its
   * `options` arrive EMPTY here and are filled by the step from data the page
   * fetched, which is why such a field survives the "fewer than two options"
   * filter below: at this layer it has none yet, and dropping it would delete
   * the only control the metric has.
   */
  source?: "projectTags";
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
  sources?: Record<string, "projectTags">,
): DashboardFilterField[] => {
  const shape = z.schema.shape(schema);
  const fields: DashboardFilterField[] = [];

  for (const [name, raw] of Object.entries(shape)) {
    const source = sources?.[name];
    if (source) {
      // A field whose values are ROWS. The schema types it as text and could
      // not enumerate it; the step fills the options from the project.
      fields.push({ name, options: [], multiple: false, source });
      continue;
    }

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

  // A source-backed field keeps its place with zero options: they arrive at
  // the step, not here. Everything else with fewer than two is not a choice.
  return fields.filter((field) => field.source || field.options.length > 1);
};
