import * as React from "react";

void React;

import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import type { FormModel } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { ShieldCheck } from "lucide-react";

import type { ProfilePolicy } from "./admin-user-detail-profile-policy.ts";
import type { profileSchema } from "./admin-user-detail-profile-schema.ts";

export interface AdminUserDetailOverviewTabProps {
  form: FormModel<typeof profileSchema>;
  /**
   * Role metadata for the roles picker. `default: true` roles are offered
   * but not togglable.
   */
  availableRoles: ReadonlyArray<{ name: string; default?: boolean }>;
  /**
   * Which identity fields the realm collects. A field the realm has turned
   * off is not rendered at all — an Email input on a username-only realm is
   * an invitation to write a value nothing can use.
   */
  policy: ProfilePolicy;
}

/**
 * Overview tab: the editable profile form.
 */
export const AdminUserDetailOverviewTab = (
  props: AdminUserDetailOverviewTabProps,
) => {
  const { tr } = useI18n();

  // AutoForm renders every key of the schema unless it is handed groups, so
  // one group carrying the offered fields is how a field is left out.
  const fields = (
    [
      "username",
      "email",
      "emailVerified",
      "firstName",
      "lastName",
      "roles",
    ] as const
  ).filter((name) => {
    if (name === "username") return props.policy.username.visible;
    // The verified flag is meaningless without the address it qualifies.
    if (name === "email" || name === "emailVerified") {
      return props.policy.email.visible;
    }
    return true;
  });

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex max-w-6xl flex-col gap-6 p-6">
        <AutoForm
          form={props.form}
          groups={[{ fields: [...fields] }]}
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
