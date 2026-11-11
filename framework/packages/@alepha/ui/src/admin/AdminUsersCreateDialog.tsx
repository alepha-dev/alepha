import * as React from "react";

void React;

import type {
  AdminUserController,
  CreateUser,
  RealmController,
  UserEntity,
} from "alepha/api/users";
import { useClient, useQuery } from "alepha/react";
import { FormValidationError, useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import { Button } from "../core/Button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../core/Dialog.tsx";
import { Control } from "../form/Control.tsx";
import { profilePolicy } from "./adminUserDetailProfilePolicy.ts";
import {
  type CreateUserForm,
  createUserFormSchema,
} from "./adminUsersCreateSchema.ts";

export interface AdminUsersCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Realm to create the user in. Defaults to the configured user realm.
   */
  userRealmName?: string;
  onCreated: (created: UserEntity) => void;
}

/**
 * Create a user from the admin. The realm decides which of `username` and
 * `email` are offered: a username the realm derives from the email
 * (`username: "email"`) or does not collect is not asked for.
 *
 * The password is optional and set with a second call, since the create
 * endpoint takes none. Left blank, the account exists but cannot sign in
 * with credentials until a password is set from its detail page.
 */
export const AdminUsersCreateDialog = (props: AdminUsersCreateDialogProps) => {
  const { tr } = useI18n();
  const client = useClient<AdminUserController>();
  const realmClient = useClient<RealmController>();

  const realmQuery = useQuery(
    {
      handler: ({ signal }) =>
        realmClient.getRealmConfig(
          { query: { realmName: props.userRealmName } },
          { request: { signal } },
        ),
      // Without the settings every field is offered as optional, and the
      // server still refuses what it must.
      onError: () => {},
    },
    [realmClient, props.userRealmName],
  );
  const settings = realmQuery.data?.settings;
  const policy = profilePolicy(settings);
  const showUsername =
    policy.username.visible && settings?.username !== "email";
  const canSetPassword = client.setUserPassword.can();

  const form = useForm(
    {
      schema: createUserFormSchema,
      initialValues: {
        email: "",
        username: "",
        firstName: "",
        lastName: "",
        password: "",
      },
      handler: async (values: CreateUserForm) => {
        const email = (values.email ?? "").trim();
        const username = (values.username ?? "").trim();
        const firstName = (values.firstName ?? "").trim();
        const lastName = (values.lastName ?? "").trim();
        const password = values.password ?? "";

        if (policy.email.visible && policy.email.required && !email) {
          throw new FormValidationError({
            message: tr("admin.users.createEmailRequired", {
              default: "Email is required",
            }),
            path: "/email",
          });
        }
        if (showUsername && policy.username.required && !username) {
          throw new FormValidationError({
            message: tr("admin.users.createUsernameRequired", {
              default: "Username is required",
            }),
            path: "/username",
          });
        }
        if (!email && !username) {
          throw new FormValidationError({
            message: tr("admin.users.createIdentifierRequired", {
              default: "Enter an email or a username",
            }),
            path: policy.email.visible ? "/email" : "/username",
          });
        }

        // Blank fields are left out, never sent as "": `users` is uniquely
        // indexed on (realm, email) and (realm, username), so an empty
        // string is a value that collides, not an absence.
        const body: CreateUser = {};
        if (policy.email.visible && email) body.email = email;
        if (showUsername && username) body.username = username;
        if (firstName) body.firstName = firstName;
        if (lastName) body.lastName = lastName;

        const created = await client.createUser({
          query: { userRealmName: props.userRealmName },
          body,
        });
        try {
          if (canSetPassword && password) {
            await client.setUserPassword({
              params: { id: created.id },
              query: { userRealmName: props.userRealmName },
              body: { password },
            });
          }
        } finally {
          // The user exists whether or not the password was accepted: close
          // and show it, and let the error (a refused password policy) toast.
          form.reset();
          props.onOpenChange(false);
          props.onCreated(created);
        }
      },
    },
    [client, props.userRealmName, settings, canSetPassword],
  );

  const formState = useFormState(form, ["loading"]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr("admin.users.createTitle", { default: "Create user" })}
          </DialogTitle>
          <DialogDescription>
            {tr("admin.users.createDescription", {
              default:
                "The account is created enabled, with the realm's default roles.",
            })}
          </DialogDescription>
        </DialogHeader>
        <form
          {...form.props}
          className="flex flex-col gap-4"
          id="create-user-form"
        >
          {policy.email.visible && (
            <Control
              label={tr("admin.users.colEmail", { default: "Email" })}
              input={form.input.email}
              text
            />
          )}
          {showUsername && (
            <Control
              label={tr("admin.users.colUsername", { default: "Username" })}
              input={form.input.username}
              text
            />
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Control
              label={tr("admin.users.colFirstName", { default: "First name" })}
              input={form.input.firstName}
              text
            />
            <Control
              label={tr("admin.users.colLastName", { default: "Last name" })}
              input={form.input.lastName}
              text
            />
          </div>
          {canSetPassword && (
            <Control
              label={tr("admin.users.createPassword", {
                default: "Password",
              })}
              description={tr("admin.users.createPasswordHint", {
                default:
                  "Optional. Without one, the user cannot sign in until a password is set.",
              })}
              input={form.input.password}
              password
            />
          )}
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="minimal"
            onClick={() => props.onOpenChange(false)}
          >
            {tr("admin.users.createCancel", { default: "Cancel" })}
          </Button>
          <Button
            type="submit"
            form="create-user-form"
            loading={formState.loading}
          >
            {tr("admin.users.create", { default: "Create user" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
