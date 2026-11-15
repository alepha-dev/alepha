import { $atom, z } from "alepha";

/**
 * Flat list of every directory in the current project — what
 * `DirectoryController.listAllDirectories` returns. Pre-fetched by
 * route loaders that render components which need a directory tree
 * (e.g. the folio workspace's tree pane), so the component can render from atom
 * instead of firing its own request and missing the alepha auto-batch
 * window. See Lore quest #109.
 */
export const projectDirectoriesAtom = $atom({
  name: "lor.project.directories",
  schema: z.array(
    z.object({
      id: z.uuid(),
      shortId: z.integer(),
      name: z.string(),
      parentId: z.uuid().optional(),
    }),
  ),
  default: [],
});
