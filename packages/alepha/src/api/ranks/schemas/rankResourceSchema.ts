import { type Infer, z } from "alepha";

/**
 * One rank, as the module's HTTP surface answers it.
 *
 * Deliberately not derived from `rankDefinitions.schema`: half the ranks a
 * scope has are declared in code and have no row, so a schema picked off the
 * entity would carry an `id`, a `version` and an `organizationId` that a
 * built-in cannot fill.
 */
export const rankResourceSchema = z.object({
  key: z.text({
    description:
      "Stable id an assignment stores. Opaque, and never derived from the name.",
  }),
  name: z.text({ description: "What a person reads." }),
  permissions: z
    .array(z.text())
    .describe("What this rank grants, as group:name."),
  builtin: z
    .boolean()
    .describe(
      "Declared in code or marked permanent: non-removable, and refusing edits rather than being reset from code later.",
    ),
  editable: z
    .boolean()
    .describe(
      "Whether a rewrite will be accepted. ⚠️ Not the negation of `builtin`: a built-in declared `configurable` is both, which is the shape of a default rank an administrator is expected to tune.",
    ),
});

export type RankResource = Infer<typeof rankResourceSchema>;
