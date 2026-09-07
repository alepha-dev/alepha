import { SettingsHeading } from "@alepha/ui/components/settings/settings-heading";
import { SettingsRow } from "@alepha/ui/components/settings/settings-row";
import { SettingsSection } from "@alepha/ui/components/settings/settings-section";
import { Switch } from "@alepha/ui/components/ui/switch";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useState } from "react";

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
  const toast = useToast();

  const [prefs, setPrefs] = useState<NotificationPreferenceResource>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .getMyNotificationPreferences()
      .then((row) => {
        if (alive) setPrefs(row);
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [api]);

  const save = async (patch: {
    emailEnabled?: boolean;
    mutedCategories?: string[];
  }) => {
    // Optimistic, so the switch answers the click. The server is the
    // authority and its answer replaces this a moment later.
    setPrefs((current) => (current ? { ...current, ...patch } : current));
    setBusy(true);
    try {
      const saved = await api.updateMyNotificationPreferences({ body: patch });
      setPrefs(saved);
    } catch {
      toast.error(String(tr("account.notifications.saveFailed")));
      // Put back what the server still believes.
      const row = await api
        .getMyNotificationPreferences()
        .catch(() => undefined);
      if (row) setPrefs(row);
    } finally {
      setBusy(false);
    }
  };

  if (!prefs) {
    return null;
  }

  const toggleCategory = (category: string, wanted: boolean) => {
    const muted = wanted
      ? prefs.mutedCategories.filter((it) => it !== category)
      : [...prefs.mutedCategories, category];
    void save({ mutedCategories: muted });
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsHeading
        title={String(tr("account.notifications.title"))}
        description={String(tr("account.notifications.description"))}
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
            onCheckedChange={(value) => void save({ emailEnabled: value })}
            aria-label={String(tr("account.notifications.email"))}
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
    </div>
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
  tr: (key: never) => string | number,
  category: string,
): string => {
  const key = `account.notifications.category.${category}`;
  const label = String(tr(key as never));
  return label === key ? category : label;
};

const categoryGloss = (
  tr: (key: never) => string | number,
  category: string,
): string | undefined => {
  const key = `account.notifications.category.${category}.description`;
  const gloss = String(tr(key as never));
  return gloss === key ? undefined : gloss;
};

export default MyNotifications;
