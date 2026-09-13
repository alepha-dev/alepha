import * as React from "react";

void React;

import { Control } from "@alepha/ui/components/control/control";
import type { useFieldValue } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { CircleDot } from "lucide-react";

export interface AdminUsersStatusFilterProps {
  input: Parameters<typeof useFieldValue>[0];
}

/**
 * Status dropdown for the users table filter bar.
 *
 * Clearing the control means "All status" — the empty value maps to no
 * preset rather than a fourth explicit option.
 */
export const AdminUsersStatusFilter = (props: AdminUsersStatusFilterProps) => {
  const { tr } = useI18n();

  return (
    <Control
      input={props.input}
      label=""
      clearable
      icon={CircleDot}
      clearLabel={String(
        tr("admin.users.statusAll", { default: "All status" }),
      )}
      triggerClassName="w-40"
      items={[
        {
          value: "verified",
          label: String(
            tr("admin.users.statusVerified", { default: "Verified" }),
          ),
        },
        {
          value: "active",
          label: String(tr("admin.users.statusActive", { default: "Active" })),
        },
        {
          value: "disabled",
          label: String(
            tr("admin.users.statusDisabled", { default: "Disabled" }),
          ),
        },
      ]}
    />
  );
};
