import { $atom, t } from "alepha";

/**
 * Flat list of every directory in the current campaign — what
 * `DirectoryController.listAllDirectories` returns. Pre-fetched by
 * route loaders that render components which need a directory tree
 * (e.g. `FolioTreePanel`), so the component can render from atom
 * instead of firing its own request and missing the alepha auto-batch
 * window. See Lore quest #109.
 */
export const campaignDirectoriesAtom = $atom({
  name: "lor.campaign.directories",
  schema: t.array(
    t.object({
      id: t.uuid(),
      shortId: t.integer(),
      name: t.string(),
      parentId: t.optional(t.uuid()),
    }),
  ),
  default: [],
});
