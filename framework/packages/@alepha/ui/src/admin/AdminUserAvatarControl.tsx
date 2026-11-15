import * as React from "react";

void React;

import type { AdminAvatarController, UserResource } from "alepha/api/users";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Camera, ImageUp, Trash2 } from "lucide-react";
import { type ReactNode, useRef } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../core/DropdownMenu.tsx";
import { Spinner } from "../core/Spinner.tsx";
import { useToast } from "../core/useToast.tsx";

export interface AdminUserAvatarControlProps {
  user: UserResource;
  onChanged: (user: UserResource) => void;
  /**
   * The avatar as the identity aside draws it (`DetailAside`'s
   * `renderAvatar`): this control wraps it rather than drawing a second one.
   */
  children: ReactNode;
}

/**
 * The avatar on the admin user page as its own edit control (#Q3663): a
 * labelled button over the picture, with a small camera badge and a
 * hover/focus overlay, opening a menu to upload a picture or remove it. It
 * used to be two loose buttons under the panel, away from what they changed.
 *
 * ⚠️ **On a realm with avatars off it is the plain picture**, with no badge,
 * menu or hover, and without a feature flag of its own.
 * `AdminAvatarController` is registered only by
 * `$realm({ features: { avatars: true } })`, so on a realm without it the
 * action is absent from `/api/_links` and `can()` answers false. That is the
 * same mechanism the account router uses for the API-keys page.
 *
 * `can()` also covers the permission. `admin:user:avatar` is its own, not
 * `admin:user:update`: reaching into somebody's profile picture is a
 * different capability from editing their roles.
 */
export const AdminUserAvatarControl = (props: AdminUserAvatarControlProps) => {
  const client = useClient<AdminAvatarController>();
  const toaster = useToast();
  const { tr } = useI18n();
  const input = useRef<HTMLInputElement>(null);

  // A failure is toasted by the app's ActionErrorToaster, with the server's
  // message (an image too large, a type refused).
  const change = useAction<[task: () => Promise<UserResource>, done: string]>(
    {
      handler: async (_ctx, task, done) => {
        props.onChanged(await task());
        toaster.success(done);
      },
    },
    [props.onChanged, toaster],
  );
  const busy = change.loading;

  if (!client.updateUserAvatar.can()) {
    return <>{props.children}</>;
  }

  const hasPicture = !!props.user.picture;
  const canRemove = hasPicture && client.deleteUserAvatar.can();

  return (
    <div className="relative shrink-0">
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
          void change.run(
            async () =>
              (await client.updateUserAvatar({
                params: { id: props.user.id },
                body: { file },
              })) as UserResource,
            tr("admin.userDetail.avatar.replaced", {
              default: "Avatar replaced.",
            }),
          );
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={busy}
          render={
            <button
              type="button"
              data-testid="admin-avatar-control"
              aria-label={tr("admin.userDetail.avatar.change", {
                default: "Change avatar",
              })}
              aria-busy={busy}
              className="group/avatar focus-visible:ring-ring/50 relative block rounded-md outline-none focus-visible:ring-[3px] disabled:cursor-wait"
            />
          }
        >
          {props.children}
          {/* The overlay sits on the picture, inside its rounded box; the
              badge sits outside it, at the corner, so the round mask never
              crops it (the old #Q1124). */}
          {busy ? (
            <span
              aria-hidden
              className="absolute inset-0 flex items-center justify-center rounded-md bg-black/45 text-white"
            >
              <Spinner className="size-4" />
            </span>
          ) : (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md bg-black/45 text-white opacity-0 transition-opacity group-hover/avatar:opacity-100 group-focus-visible/avatar:opacity-100"
            >
              <Camera className="size-4" />
            </span>
          )}
          <span
            aria-hidden
            className="bg-background text-muted-foreground border-border absolute -end-1.5 -bottom-1.5 flex size-5 items-center justify-center rounded-full border shadow-sm"
          >
            <Camera className="size-3" />
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            data-testid="admin-avatar-replace"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <ImageUp className="size-4" />
            {hasPicture
              ? tr("admin.userDetail.avatar.uploadNew", {
                  default: "Upload a new picture",
                })
              : tr("admin.userDetail.avatar.upload", {
                  default: "Upload a picture",
                })}
          </DropdownMenuItem>
          {canRemove && (
            <DropdownMenuItem
              variant="destructive"
              data-testid="admin-avatar-remove"
              disabled={busy}
              onClick={() =>
                void change.run(
                  async () =>
                    (await client.deleteUserAvatar({
                      params: { id: props.user.id },
                    })) as UserResource,
                  tr("admin.userDetail.avatar.removed", {
                    default: "Avatar removed.",
                  }),
                )
              }
            >
              <Trash2 className="size-4" />
              {tr("admin.userDetail.avatar.removePicture", {
                default: "Remove picture",
              })}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
