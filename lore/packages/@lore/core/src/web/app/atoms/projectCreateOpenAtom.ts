import { $atom, z } from "alepha";

/**
 * Which registered create dialog is open, by its `ProjectCreateItem.key`.
 *
 * An atom rather than component state because two triggers open the same
 * dialog from different parts of the tree: a row of the header's "+" menu,
 * and the hover "+" on the sidebar entry the item names in `navRoute`. The
 * dialogs stay mounted once, in `ProjectActionsCreateButton`, and read this.
 *
 * Wrapped in an object because `$atom` schemas must be object or array.
 */
export const projectCreateOpenAtom = $atom({
  name: "lor.project.create.open",
  schema: z.object({
    key: z.text().optional(),
  }),
  default: {},
});
