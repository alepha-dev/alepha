import { Switch } from "@alepha/ui";
import { AccountPage } from "@alepha/ui/account";
import {
  SettingsHeading,
  SettingsRow,
  SettingsSection,
} from "@alepha/ui/settings";
import { useAction, useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { NotificationPreferenceController } from "@/api/controllers/NotificationPreferenceController.ts";
import type { NotificationPreferenceResource } from "@/api/schemas/notificationPreferenceResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

/**
 * What this account still wants to be told about.
 *
 * Per-user, so it is here rather than in a project's settings: somebody who
 * does not want release mail does not want it from any project.
 *
 * ## ⚠️ The matrix is not square, on purpose
 *
 * Email can be switched off wholesale; the inbox cannot. A bell you have
 * silenced is a feature you have deleted, and a message nobody can see is
 * indistinguishable from one that was never sent. The page says that in a
 * line rather than showing a disabled switch, because a disabled control with
 * no explanation reads as broken.
 *
 * A muted category is muted on both channels: "I do not care about releases"
 * is one preference, not two.
 *
 * ## The categories come from the server
 *
 * A category is a string a `$notification` template registers, so the list is
 * whatever this app declares - `critical` ones excluded, since an opt-out
 * from a password reset is an account somebody cannot get back into. The
 * gloss for each is a catalogue key with a fallback to the raw name, so a
 * plugin registering a template gets a row with a readable label rather than
 * a blank one.
 */
const MyNotifications = () => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<NotificationPreferenceController>();

  const [prefs, setPrefs] = useState<NotificationPreferenceResource>();

  // Local state seeded by the read, because a save patches it before the
  // server answers. A failed read toasts: the page renders nothing without it.
  useQuery(
    {
      handler: () => api.getMyNotificationPreferences(),
      onSuccess: (row) => setPrefs(row),
    },
    [api],
  );

  const save = useAction<
    [patch: { emailEnabled?: boolean; mutedCategories?: string[] }],
    void
  >(
    {
      handler: async (patch) => {
        // Optimistic, so the switch answers the click. The server is the
        // authority and its answer replaces this a moment later; a refusal
        // puts back what was on screen and rethrows, which is what toasts.
        const previous = prefs;
        setPrefs((current) => (current ? { ...current, ...patch } : current));
        try {
          setPrefs(await api.updateMyNotificationPreferences({ body: patch }));
        } catch (error) {
          setPrefs(previous);
          throw error;
        }
      },
    },
    [api, prefs],
  );
  const busy = save.loading;

  if (!prefs) {
    return null;
  }

  const toggleCategory = (category: string, wanted: boolean) => {
    const muted = wanted
      ? prefs.mutedCategories.filter((it) => it !== category)
      : [...prefs.mutedCategories, category];
    void save.run({ mutedCategories: muted });
  };

  return (
    <AccountPage variant="form">
      <SettingsHeading
        title={tr("account.notifications.title")}
        description={tr("account.notifications.description")}
      />

      <SettingsSection
        title={tr("account.notifications.channels")}
        description={tr("account.notifications.channels.description")}
      >
        <SettingsRow
          label={tr("account.notifications.email")}
          description={tr("account.notifications.email.description")}
        >
          <Switch
            checked={prefs.emailEnabled}
            disabled={busy}
            onCheckedChange={(value) => void save.run({ emailEnabled: value })}
            aria-label={tr("account.notifications.email")}
          />
        </SettingsRow>
        {/* Not a disabled switch: the inbox has no channel switch at all, and
            a control that cannot be moved with no reason beside it reads as a
            bug rather than a decision. */}
        <SettingsRow
          label={tr("account.notifications.inbox")}
          description={tr("account.notifications.inbox.description")}
        />
      </SettingsSection>

      <SettingsSection
        title={tr("account.notifications.categories")}
        description={tr("account.notifications.categories.description")}
      >
        {prefs.categories.map((category) => (
          <SettingsRow
            key={category}
            label={categoryLabel(tr, category)}
            description={categoryGloss(tr, category)}
          >
            <Switch
              checked={!prefs.mutedCategories.includes(category)}
              disabled={busy}
              onCheckedChange={(value) => toggleCategory(category, value)}
              aria-label={categoryLabel(tr, category)}
            />
          </SettingsRow>
        ))}
      </SettingsSection>
    </AccountPage>
  );
};

/**
 * The catalogue key for a category, or the raw name for one this app has
 * never heard of.
 *
 * ⚠️ The fallback is load-bearing rather than defensive: a category is a
 * string a template registers, so a plugin can add one this page has no key
 * for, and a row labelled with an empty string is a switch nobody will
 * touch.
 */
const categoryLabel = (
  tr: (key: never) => string,
  category: string,
): string => {
  const key = `account.notifications.category.${category}`;
  const label = tr(key as never);
  return label === key ? category : label;
};

const categoryGloss = (
  tr: (key: never) => string,
  category: string,
): string | undefined => {
  const key = `account.notifications.category.${category}.description`;
  const gloss = tr(key as never);
  return gloss === key ? undefined : gloss;
};

export default MyNotifications;
