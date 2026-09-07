import { $inject, Alepha } from "alepha";
import { $notification } from "alepha/api/notifications";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import { notificationPreferences } from "../entities/notificationPreferences.ts";
import { notificationPreferenceResourceSchema } from "../schemas/notificationPreferenceResourceSchema.ts";
import { updateNotificationPreferenceBodySchema } from "../schemas/updateNotificationPreferenceBodySchema.ts";

/**
 * The caller's own notification preferences.
 *
 * Un-permissioned behind a bare `$secure()`, and safe to be: there is no id
 * parameter anywhere in this class, so the session decides the row. The same
 * argument `MyProfileController` makes for itself, and the same reason -
 * gating "read your own settings" behind a permission means every realm has
 * to remember it, and the failure mode is a settings page that renders empty
 * for users nobody thought to configure.
 */
export class NotificationPreferenceController {
  protected readonly alepha = $inject(Alepha);
  protected readonly prefs = $repository(notificationPreferences);

  getMyNotificationPreferences = $action({
    method: "GET",
    path: "/users/me/notification-preferences",
    use: [$secure()],
    description: "Read the caller's own notification preferences",
    schema: {
      response: notificationPreferenceResourceSchema,
    },
    handler: async ({ user }) => {
      const row = await this.prefs.findOne({
        where: { userId: { eq: user.id } },
      });
      return {
        // An absent row means nothing has been turned off, so nobody is
        // backfilled and a new account reads as "everything on".
        emailEnabled: row?.emailEnabled ?? true,
        mutedCategories: row?.mutedCategories ?? [],
        categories: this.categories(),
      };
    },
  });

  updateMyNotificationPreferences = $action({
    method: "PATCH",
    path: "/users/me/notification-preferences",
    use: [$secure()],
    description: "Update the caller's own notification preferences",
    schema: {
      body: updateNotificationPreferenceBodySchema,
      response: notificationPreferenceResourceSchema,
    },
    handler: async ({ body, user }) => {
      const existing = await this.prefs.findOne({
        where: { userId: { eq: user.id } },
      });

      // An unknown category would be dead weight in the column and would
      // survive a template being removed, so the write is narrowed to what
      // this app actually declares.
      const known = new Set(this.categories());
      const muted = body.mutedCategories?.filter((it) => known.has(it));

      const row = existing
        ? await this.prefs.updateById(existing.id, {
            ...(body.emailEnabled !== undefined
              ? { emailEnabled: body.emailEnabled }
              : {}),
            ...(muted !== undefined ? { mutedCategories: muted } : {}),
          })
        : await this.prefs.create({
            userId: user.id,
            emailEnabled: body.emailEnabled ?? true,
            mutedCategories: muted ?? [],
          });

      return {
        emailEnabled: row.emailEnabled,
        mutedCategories: row.mutedCategories,
        categories: this.categories(),
      };
    },
  });

  /**
   * The categories a person may switch off.
   *
   * ⚠️ Read from the container's own registry rather than from
   * `AdminNotificationController.listNotificationTemplates`, which is behind
   * `admin:notification:read` and would 403 for somebody reading their own
   * settings. In process, no query, no framework change, and still not a
   * hard-coded list.
   *
   * `critical` templates are excluded: all seven of `alepha/api/users`'s are
   * the password reset, the sign-in code and the verification mail, and an
   * opt-out from those is an account somebody cannot get back into.
   */
  protected categories(): string[] {
    const found = new Set<string>();
    for (const template of this.alepha.primitives($notification)) {
      const options = template.options as {
        category?: string;
        critical?: boolean;
      };
      if (options.critical) continue;
      if (options.category) found.add(options.category);
    }
    return [...found].sort((a, b) => a.localeCompare(b));
  }
}
