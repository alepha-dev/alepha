import { SettingsSection } from "@alepha/ui/components/settings/settings-section";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import AppSettingsDelete from "./AppSettingsDelete.tsx";
import AppSettingsEstate from "./AppSettingsEstate.tsx";
import AppSettingsRename from "./AppSettingsRename.tsx";
import AppSettingsSigil from "./AppSettingsSigil.tsx";
import AppSettingsUrl from "./AppSettingsUrl.tsx";

/**
 * Everything an operator decides about one deployed copy: its two names, its
 * address, its credential, where it deploys to, and its removal.
 *
 * Built on the shared settings blocks rather than a column of bespoke cards,
 * which is what puts it in the same rhythm as every other settings page in the
 * app. `SettingsSection` is `py-0` and every `SettingsRow` brings its own
 * `py-3`; leaving both on stacks into a thick blank band, so do not "fix" that
 * to a numeric padding.
 *
 * **Two controls left this page rather than being ported**, back when it was a
 * sigil's page. The four `kinds` switches and the feedback-button position read
 * as the app's configuration and are not: `SIGIL_CONFIG` in the app's own
 * deploy decides what gets SENT, and `kinds` decides only what this sink
 * ACCEPTS. Two switches for one behaviour, neither aware of the other. `kinds`
 * stays enforced in `SigilIngestService.gatesFor` and is read-only on the
 * Overview, beside what the app claims to send, which is where a disagreement
 * between them becomes visible.
 *
 * ⚠️ Each row owns its own PATCH and sends only its own key, which is what lets
 * five of them share one instance without any of them writing a stale copy of
 * another's draft. `updateApp` treats an absent key as "leave it alone".
 */
const AppSettings = () => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const [instance] = useStore(currentInstanceAtom);

  if (!project || !instance) {
    return null;
  }

  return (
    // Settings declares its own measure. `AppLayout` used to cap every tab at
    // `max-w-6xl` so this one would not read badly at full width, which also
    // denied the width to Analytics and Vitals, which want it. Each tab
    // answers for itself now: this one at `max-w-3xl`, the rest full width.
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <SettingsSection title={tr("app.settings.general")}>
        {/*
          Keyed by the instance, and all three must be. Moving between two
          instances' Settings tabs swaps `currentInstanceAtom` without
          unmounting anything, so an unkeyed draft would keep showing - and on
          Save, write - the value of the instance you just left. `SettingsRow`
          does not unmount it for you.
        */}
        <AppSettingsRename key={`app-${instance.id}`} half="app" />
        <AppSettingsRename key={`env-${instance.id}`} half="env" />
        <AppSettingsUrl key={`url-${instance.id}`} />
      </SettingsSection>

      <AppSettingsSigil />

      <AppSettingsEstate />

      <AppSettingsDelete />
    </div>
  );
};

export default AppSettings;
