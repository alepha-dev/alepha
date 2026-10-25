import { type Infer, z } from "alepha";

/**
 * The permissions an application declares, grouped and ordered, as a
 * permission editor renders them: a rank matrix, or the scope picker of an
 * API key.
 *
 * Every `name` is the FULL `group:name`, never the registry's bare `name`:
 * it is the string a rank or a scope stores and the string the write path
 * validates. A matrix built from a bare `read` sends back a permission nothing
 * recognises.
 *
 * `label`s are translation keys, passed through untranslated so a client
 * renders them in its reader's language. Most are absent: permissions the
 * framework declares through `$secure` carry none.
 */
export const permissionCatalogueSchema = z.object({
  groups: z.array(
    z.object({
      name: z.text(),
      label: z.text().optional(),
      order: z.integer().optional(),
      permissions: z.array(
        z.object({
          name: z.text(),
          label: z.text().optional(),
          description: z.text().optional(),
        }),
      ),
    }),
  ),
});

export type PermissionCatalogue = Infer<typeof permissionCatalogueSchema>;
