import * as React from "react";

void React;

import { Button } from "@alepha/ui/components/ui/button";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type { AdminAvatarController, UserResource } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { ImageUp, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

export interface AdminUserAvatarControlProps {
  user: UserResource;
  onChanged: (user: UserResource) => void;
}

/**
 * Replace or remove another user's avatar, under the identity aside.
 *
 * ⚠️ **Renders nothing when the realm has avatars off**, and does so without
 * a feature flag of its own. `AdminAvatarController` is registered only by
 * `$realm({ features: { avatars: true } })`, so on a realm without it the
 * action is absent from `/api/_links` and `can()` answers false. That is the
 * same mechanism the account router uses for the API-keys page, and it is
 * better than a flag: a flag is a second thing to keep in step with the
 * endpoint, and it drifts silently when it does not.
 *
 * `can()` also covers the permission. `admin:user:avatar` is its own, not
 * `admin:user:update`: reaching into somebody's profile picture is a
 * different capability from editing their roles, and an operator trusted with
 * one is not automatically trusted with the other.
 */
export const AdminUserAvatarControl = (props: AdminUserAvatarControlProps) => {
  const client = useClient<AdminAvatarController>();
  const toaster = useToast();
  const { tr } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  if (!client.updateUserAvatar.can()) {
    return null;
  }

  const run = async (task: () => Promise<UserResource>, done: string) => {
    setBusy(true);
    try {
      props.onChanged(await task());
      toaster.success(done);
    } catch (error: any) {
      toaster.error(
        error?.message ??
          String(
            tr("admin.userDetail.avatar.failed", {
              default: "Could not change the avatar.",
            }),
          ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid="admin-avatar-file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared before the upload, not after: the same file picked twice
          // in a row fires no `change` while the value is still set.
          event.target.value = "";
          if (!file) return;
          void run(
            async () =>
              (await client.updateUserAvatar({
                params: { id: props.user.id },
                body: { file },
              })) as UserResource,
            String(
              tr("admin.userDetail.avatar.replaced", {
                default: "Avatar replaced.",
              }),
            ),
          );
        }}
      />

      <Button
        variant="outline"
        size="sm"
        loading={busy}
        data-testid="admin-avatar-replace"
        onClick={() => input.current?.click()}
      >
        <ImageUp className="size-4" />
        {tr("admin.userDetail.avatar.replace", { default: "Replace avatar" })}
      </Button>

      {props.user.picture && client.deleteUserAvatar.can() && (
        <Button
          variant="ghost"
          size="sm"
          loading={busy}
          data-testid="admin-avatar-remove"
          onClick={() =>
            void run(
              async () =>
                (await client.deleteUserAvatar({
                  params: { id: props.user.id },
                })) as UserResource,
              String(
                tr("admin.userDetail.avatar.removed", {
                  default: "Avatar removed.",
                }),
              ),
            )
          }
        >
          <Trash2 className="size-4" />
          {tr("admin.userDetail.avatar.remove", { default: "Remove" })}
        </Button>
      )}
    </div>
  );
};
