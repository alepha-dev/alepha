import { type BaseInputField, useFieldValue } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import type { PermissionCatalogue } from "alepha/security";
import { useMemo } from "react";

import {
  PermissionMatrix,
  type PermissionMatrixGroup,
} from "../table/PermissionMatrix.tsx";

export interface ApiKeyScopeMatrixProps {
  /**
   * The form field holding the selected permissions, as `group:name`
   * strings. The matrix keeps no selection of its own.
   */
  input: BaseInputField;

  /**
   * The caller's grantable permissions, from `GET /api-keys/options`.
   */
  groups: PermissionCatalogue["groups"];
}

/**
 * Pick the permissions an API key is narrowed to: `PermissionMatrix` with one
 * column, fed by the caller's own ceiling.
 *
 * ⚠️ **Unlabelled rows are the normal case, and they are kept.** The
 * framework's own permissions (`api-key:create`, `admin:user:read`,
 * `file:read`) carry no label, and they are exactly what a CI key gets scoped
 * to, so a group with no label shows its raw name and a permission with no
 * label its full `group:name`, where Lore's rank matrix drops them. Labels
 * that exist are translation keys, translated here; a key the catalogue does
 * not know renders as written, so a label declared as plain text still reads.
 *
 * Every value it sends is a concrete permission name: a fully ticked group is
 * still a list of names, never `group:*`, which the server refuses for a key.
 */
export const ApiKeyScopeMatrix = (props: ApiKeyScopeMatrixProps) => {
  const { tr } = useI18n();
  const [value, setValue] = useFieldValue(props.input);

  const groups = useMemo<PermissionMatrixGroup[]>(
    () =>
      props.groups.map((group) => ({
        key: group.name || "-",
        label: group.label
          ? tr(group.label, { default: group.label })
          : group.name ||
            tr("account.keys.scopeUngrouped", {
              default: "Other",
            }),
        permissions: group.permissions.map((permission) => ({
          name: permission.name,
          label: permission.label
            ? tr(permission.label, { default: permission.label })
            : permission.name,
          description: permission.description
            ? tr(permission.description, { default: permission.description })
            : undefined,
        })),
      })),
    [props.groups],
  );

  return (
    <PermissionMatrix
      groups={groups}
      columns={[
        {
          key: "scope",
          label: tr("account.keys.scopeColumn", { default: "Allowed" }),
        },
      ]}
      value={{ scope: (value as string[] | undefined) ?? [] }}
      onChange={(next) => setValue(next.scope ?? [])}
      header={tr("account.keys.scopeHeader", { default: "Permission" })}
      empty={tr("account.keys.scopeEmpty", {
        default: "You hold no permission a key could be narrowed to.",
      })}
      className="max-h-80"
    />
  );
};
