import * as React from "react";

void React;

import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import type { FormModel } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { ShieldCheck } from "lucide-react";
import type { profileSchema } from "./admin-user-detail-profile-schema.ts";

export interface AdminUserDetailOverviewTabProps {
  form: FormModel<typeof profileSchema>;
  /**
   * Role metadata for the roles picker. `default: true` roles are offered
   * but not togglable.
   */
  availableRoles: ReadonlyArray<{ name: string; default?: boolean }>;
}

/**
 * Overview tab: the editable profile form.
 */
export const AdminUserDetailOverviewTab = (
  props: AdminUserDetailOverviewTabProps,
) => {
  const { tr } = useI18n();

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex max-w-6xl flex-col gap-6 p-6">
        <AutoForm
          form={props.form}
          card
          icon="user"
          title={tr("admin.userDetail.profile", { default: "Profile" })}
          description={tr("admin.userDetail.profileSub", {
            default: "Identity and contact info.",
          })}
          submitLabel={tr("admin.userDetail.save", {
            default: "Save changes",
          })}
          disabledIfPristine
          fields={{
            username: {
              label: String(
                tr("admin.userDetail.username", { default: "Username" }),
              ),
            },
            email: {
              label: String(tr("admin.userDetail.email", { default: "Email" })),
            },
            emailVerified: {
              label: String(
                tr("admin.userDetail.emailVerified", {
                  default: "Email verified",
                }),
              ),
            },
            firstName: {
              label: String(
                tr("admin.userDetail.firstName", {
                  default: "First name",
                }),
              ),
            },
            lastName: {
              label: String(
                tr("admin.userDetail.lastName", {
                  default: "Last name",
                }),
              ),
            },
            roles: {
              label: String(tr("admin.userDetail.roles", { default: "Roles" })),
              icon: ShieldCheck,
              items: props.availableRoles.map((r) => ({
                value: r.name,
                label: r.name,
                disabled: r.default,
              })),
            },
          }}
        />
      </div>
    </div>
  );
};
