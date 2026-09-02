import { type Infer, z } from "alepha";

/**
 * Where a tree node comes from.
 *
 * - `registered`: a `$parameter` declares it and nothing is saved yet.
 * - `orphan`: rows exist in the database and no `$parameter` declares the
 *   name. Nothing reads it, editing it changes nothing, and it outlives the
 *   code that once used it: a rename or a removal leaves one behind. It can
 *   also mean a module that simply is not loaded in this process, which is
 *   why an orphan is shown on request and never deleted on its own.
 * - `both`: declared and saved, the ordinary case.
 *
 * A folder carries the origin its leaves agree on, so a whole retired branch
 * (`lore.campaign.*`) reads as one orphan; `both` when they disagree.
 */
export const parameterOriginSchema = z.enum(["registered", "orphan", "both"]);

export type ParameterOrigin = Infer<typeof parameterOriginSchema>;

/**
 * Tree node schema for parameter tree navigation.
 */
export const parameterTreeNodeSchema = z.object({
  name: z.text(),
  path: z.text(),
  isLeaf: z.boolean(),
  origin: parameterOriginSchema,
  children: z.array(z.any()),
});

export type ParameterTreeNode = Infer<typeof parameterTreeNodeSchema>;
